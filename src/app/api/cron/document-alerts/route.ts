import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendAlertasVencimientoEmail } from "@/lib/mailer";
import { logAuditEvent } from "@/lib/audit";
import { diasRestantes, seleccionarVigentes } from "@/lib/acreditacion";

/**
 * Umbrales de alerta, en días respecto del vencimiento.
 * Positivo = días antes. 0 = el día que vence. Negativo = recordatorio
 * posterior para lo que sigue sin renovarse.
 */
const ALERT_THRESHOLDS = [60, 30, 15, 7, 0, -3, -7] as const;

function severidad(t: number): "vencido" | "critico" | "medio" | "preventivo" {
  if (t <= 0) return "vencido";
  if (t <= 7) return "critico";
  if (t <= 30) return "medio";
  return "preventivo";
}

/**
 * Barrido diario de vencimientos documentales.
 *
 * Lee del modelo de acreditación (`DocumentoAcreditacion`), toma el
 * documento vigente por (trabajador, tipo) y avisa cuando cruza un umbral.
 * Agrupa por destinatario: un solo correo con todo, no uno por documento.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` o `?token=<CRON_SECRET>`.
 * `?dryRun=1` simula sin enviar ni escribir.
 *
 * Programación sugerida: diario 08:00 hora de Chile (12:00 UTC).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const provided =
    (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "") ||
    (req.nextUrl.searchParams.get("token") ?? "");

  if (process.env.NODE_ENV === "production") {
    if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 500 });
    if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else if (secret && provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const today = new Date();

  // ── Destinatarios ────────────────────────────────────────────────────
  const gestores = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ["ADMINISTRADOR", "OPERATIVO", "ADMIN", "ADMIN_LIMITADO", "RRHH"] },
    },
    select: { email: true },
  });

  const envEmails = (process.env.DOCUMENT_ALERT_EMAILS ?? "")
    .split(",").map(e => e.trim()).filter(Boolean);

  const recipients = Array.from(new Set([...envEmails, ...gestores.map(u => u.email).filter(Boolean)]));

  if (recipients.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "Sin destinatarios: configura DOCUMENT_ALERT_EMAILS o crea usuarios Administrador/Operativo",
    }, { status: 400 });
  }

  // ── Documentos vigentes de trabajadores activos ──────────────────────
  const staff = await db.staffMember.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, camp: { select: { name: true } } },
  });
  const staffById = new Map(staff.map(s => [s.id, s]));

  if (staff.length === 0) {
    return NextResponse.json({ ok: true, dryRun, aviso: "No hay trabajadores activos" });
  }

  const [documentos, tipos] = await Promise.all([
    db.documentoAcreditacion.findMany({
      where: { staffMemberId: { in: staff.map(s => s.id) }, anulado: false },
      select: {
        id: true, staffMemberId: true, tipoDocumentoId: true,
        fechaVencimiento: true, sinVencimiento: true, anulado: true, createdAt: true,
      },
    }),
    db.tipoDocumento.findMany({ where: { activo: true }, select: { id: true, nombre: true } }),
  ]);

  if (tipos.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "El catálogo de tipos no está inicializado. Corré /api/admin/migrar-acreditacion primero.",
    }, { status: 400 });
  }

  const nombreTipo = new Map(tipos.map(t => [t.id, t.nombre]));
  const vigentes = seleccionarVigentes(documentos);

  // ── Detectar cruces de umbral ────────────────────────────────────────
  type Pendiente = {
    staffMemberId: string;
    workerName: string;
    campName: string;
    tipoDocumentoId: string;
    docLabel: string;
    dueDate: Date;
    dias: number;
    threshold: number;
  };

  const pendientes: Pendiente[] = [];

  for (const doc of vigentes.values()) {
    if (doc.sinVencimiento || !doc.fechaVencimiento) continue;

    const dias = diasRestantes(doc.fechaVencimiento, today);
    if (dias == null) continue;

    const threshold = ALERT_THRESHOLDS.find(t => dias === t);
    if (threshold == null) continue;

    const worker = staffById.get(doc.staffMemberId);
    if (!worker) continue;

    pendientes.push({
      staffMemberId: doc.staffMemberId,
      workerName: worker.fullName,
      campName: worker.camp?.name ?? "Sin asignar",
      tipoDocumentoId: doc.tipoDocumentoId,
      docLabel: nombreTipo.get(doc.tipoDocumentoId) ?? "Documento",
      dueDate: doc.fechaVencimiento,
      dias,
      threshold,
    });
  }

  // ── Descartar los ya avisados ────────────────────────────────────────
  const yaEnviadas = pendientes.length === 0 ? [] : await db.alertaDocumento.findMany({
    where: {
      OR: pendientes.map(p => ({
        staffMemberId: p.staffMemberId,
        docType: p.tipoDocumentoId,
        dueDate: p.dueDate,
        threshold: p.threshold,
      })),
    },
    select: { staffMemberId: true, docType: true, dueDate: true, threshold: true },
  });

  const clavesEnviadas = new Set(
    yaEnviadas.map(e => `${e.staffMemberId}|${e.docType}|${e.dueDate.toISOString()}|${e.threshold}`),
  );

  const nuevas = pendientes.filter(
    p => !clavesEnviadas.has(`${p.staffMemberId}|${p.tipoDocumentoId}|${p.dueDate.toISOString()}|${p.threshold}`),
  );

  // ── Enviar (un correo con todo) ──────────────────────────────────────
  const appHost = process.env.APP_URL ?? "https://nomadecontrol-production.up.railway.app";
  let sentEmail = false;

  if (nuevas.length > 0 && !dryRun) {
    await sendAlertasVencimientoEmail({
      to: recipients,
      fechaLabel: today.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" }),
      alertas: nuevas.map(a => ({
        severidad: severidad(a.threshold),
        categoria: "trabajador",
        nombre: a.docLabel,
        entidad: `${a.workerName} · ${a.campName}`,
        diasRestantes: a.dias,
        fechaVencimiento: a.dueDate,
        href: `${appHost}/trabajadores/${a.staffMemberId}?tab=documentos`,
      })),
    });
    sentEmail = true;

    await db.alertaDocumento.createMany({
      data: nuevas.map(a => ({
        staffMemberId: a.staffMemberId,
        docType: a.tipoDocumentoId,
        dueDate: a.dueDate,
        threshold: a.threshold,
        recipients: recipients.join(","),
      })),
      skipDuplicates: true,
    });

    await logAuditEvent({
      actorName: "system-cron",
      actorEmail: "system@nomadecontrol",
      action: "DOCUMENT_ALERTS_SENT",
      entityType: "system",
      summary: `Envió ${nuevas.length} alertas de vencimiento a ${recipients.length} destinatario(s)`,
      metadata: { thresholds: ALERT_THRESHOLDS, count: nuevas.length, recipients },
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    trabajadoresRevisados: staff.length,
    documentosVigentes: vigentes.size,
    umbrales: ALERT_THRESHOLDS,
    cruces: pendientes.length,
    yaAvisadas: pendientes.length - nuevas.length,
    nuevasAlertas: nuevas.length,
    sentEmail,
    recipients,
    detalle: nuevas.map(a => ({
      trabajador: a.workerName,
      documento: a.docLabel,
      vence: a.dueDate.toISOString().slice(0, 10),
      dias: a.dias,
      umbral: a.threshold,
      severidad: severidad(a.threshold),
    })),
  });
}

export const GET = POST;
