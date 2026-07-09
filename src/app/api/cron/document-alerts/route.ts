import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { STAFF_DOCUMENT_FIELDS, daysUntilDate } from "@/lib/staff-docs";
import { sendAlertasVencimientoEmail } from "@/lib/mailer";
import { logAuditEvent } from "@/lib/audit";

// Umbrales de alerta (días antes o después del vencimiento)
// - Positivos: días antes del vencimiento
// - 0: día del vencimiento
// - Negativos: días después del vencimiento (recordatorios post-vencido)
const ALERT_THRESHOLDS = [30, 15, 7, 0, -3, -7] as const;

function thresholdSeverity(t: number): "vencido" | "critico" | "medio" | "preventivo" {
  if (t <= 0) return "vencido";
  if (t <= 7) return "critico";
  if (t <= 15) return "medio";
  return "preventivo";
}

/**
 * Ejecuta el barrido diario de alertas de documentos.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>` o query `?token=<CRON_SECRET>`.
 * Para debug se puede llamar sin auth solo si NODE_ENV != production (bloqueado en prod).
 *
 * Programación recomendada: 1 vez al día a las 08:00 hora Chile.
 * En Railway: agrega un cron con URL `POST https://<host>/api/cron/document-alerts`
 * pasando el header Authorization.
 *
 * Query params:
 *  - dryRun=1 → simula sin enviar correos ni guardar en BD
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const providedByHeader = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const providedByQuery = req.nextUrl.searchParams.get("token") ?? "";
  const provided = providedByHeader || providedByQuery;

  if (process.env.NODE_ENV === "production") {
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 500 });
    }
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (secret && provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  const today = new Date();

  // 1. Cargar trabajadores activos con sus fechas
  const staff = await db.staffMember.findMany({
    where: { isActive: true },
    include: { camp: true },
  });

  // 2. Cargar destinatarios base:
  //    - Env DOCUMENT_ALERT_EMAILS (csv)
  //    - Usuarios activos con role RRHH, ADMINISTRADOR o ADMIN_LIMITADO
  const [rrhhAdmins] = await Promise.all([
    db.user.findMany({
      where: {
        isActive: true,
        role: { in: ["RRHH", "ADMINISTRADOR", "ADMIN", "ADMIN_LIMITADO"] },
      },
      select: { email: true },
    }),
  ]);

  const envEmails = (process.env.DOCUMENT_ALERT_EMAILS ?? "")
    .split(",")
    .map(e => e.trim())
    .filter(Boolean);

  const recipientsBase = Array.from(new Set([
    ...envEmails,
    ...rrhhAdmins.map(u => u.email).filter(Boolean),
  ]));

  if (recipientsBase.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "No hay destinatarios: configura DOCUMENT_ALERT_EMAILS o usuarios con role RRHH/ADMINISTRADOR",
    }, { status: 400 });
  }

  // 3. Recorrer todos los pares (trabajador, tipo documento) y detectar
  //    los que caen en un umbral y no han sido notificados aún para esa
  //    combinación (staffMemberId, docType, dueDate, threshold).
  const pendingAlerts: Array<{
    workerId: string;
    workerName: string;
    campName: string;
    docLabel: string;
    docKey: string;
    dueDate: Date;
    daysRemaining: number;
    threshold: number;
    severity: "vencido" | "critico" | "medio" | "preventivo";
  }> = [];

  for (const w of staff) {
    for (const field of STAFF_DOCUMENT_FIELDS) {
      const dueDate = (w as any)[field.key] as Date | null;
      if (!dueDate) continue;

      const days = daysUntilDate(dueDate, today);
      if (days == null) continue;

      // El umbral aplicable es el más pequeño ≥ days (para alertas anticipadas)
      // o el que coincida en alertas post-vencido.
      const matchedThreshold = ALERT_THRESHOLDS.find(t => days === t);
      if (matchedThreshold == null) continue;

      pendingAlerts.push({
        workerId: w.id,
        workerName: w.fullName,
        campName: w.camp?.name ?? "Sin asignar",
        docLabel: field.label,
        docKey: field.key,
        dueDate,
        daysRemaining: days,
        threshold: matchedThreshold,
        severity: thresholdSeverity(matchedThreshold),
      });
    }
  }

  // 4. Filtrar los que ya se enviaron previamente (usando AlertaDocumento)
  const existing = await db.alertaDocumento.findMany({
    where: {
      OR: pendingAlerts.map(a => ({
        staffMemberId: a.workerId,
        docType: a.docKey,
        dueDate: a.dueDate,
        threshold: a.threshold,
      })),
    },
    select: { staffMemberId: true, docType: true, dueDate: true, threshold: true },
  });

  const existingKeys = new Set(existing.map(e =>
    `${e.staffMemberId}|${e.docType}|${e.dueDate.toISOString()}|${e.threshold}`
  ));

  const newAlerts = pendingAlerts.filter(a =>
    !existingKeys.has(`${a.workerId}|${a.docKey}|${a.dueDate.toISOString()}|${a.threshold}`)
  );

  // 5. Enviar correo con todas las alertas nuevas (agrupadas)
  const appHost = process.env.APP_URL ?? "https://nomadecontrol-production.up.railway.app";

  let sentEmail = false;
  if (newAlerts.length > 0 && !dryRun) {
    await sendAlertasVencimientoEmail({
      to: recipientsBase,
      fechaLabel: today.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" }),
      alertas: newAlerts.map(a => ({
        severidad: a.severity,
        categoria: "trabajador",
        nombre: a.docLabel,
        entidad: `${a.workerName} · ${a.campName}`,
        diasRestantes: a.daysRemaining,
        fechaVencimiento: a.dueDate,
        href: `${appHost}/trabajadores/${a.workerId}?tab=documentos`,
      })),
    });
    sentEmail = true;

    // 6. Registrar las alertas enviadas para no duplicar
    await db.alertaDocumento.createMany({
      data: newAlerts.map(a => ({
        staffMemberId: a.workerId,
        docType: a.docKey,
        dueDate: a.dueDate,
        threshold: a.threshold,
        recipients: recipientsBase.join(","),
      })),
      skipDuplicates: true,
    });

    await logAuditEvent({
      actorName: "system-cron",
      actorEmail: "system@nomadecontrol",
      action: "DOCUMENT_ALERTS_SENT",
      entityType: "system",
      summary: `Envió ${newAlerts.length} alertas de vencimiento a ${recipientsBase.length} destinatario(s)`,
      metadata: {
        thresholds: ALERT_THRESHOLDS,
        count: newAlerts.length,
        recipients: recipientsBase,
      },
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    checkedWorkers: staff.length,
    thresholdsScanned: ALERT_THRESHOLDS,
    matched: pendingAlerts.length,
    alreadySent: pendingAlerts.length - newAlerts.length,
    newAlerts: newAlerts.length,
    sentEmail,
    recipients: recipientsBase,
    breakdown: newAlerts.map(a => ({
      worker: a.workerName,
      doc: a.docLabel,
      dueDate: a.dueDate.toISOString().slice(0, 10),
      days: a.daysRemaining,
      threshold: a.threshold,
      severity: a.severity,
    })),
  });
}

// También permitir GET para probar desde el navegador (con token)
export const GET = POST;
