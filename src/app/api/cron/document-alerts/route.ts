import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendAlertasVencimientoEmail } from "@/lib/mailer";
import { logAuditEvent } from "@/lib/audit";
import { calcularEstado, UMBRAL_POR_VENCER_DIAS } from "@/lib/acreditacion";
import { getTiposDocumento } from "@/lib/acreditacion-db";
import { getCumplimiento } from "@/lib/requisitos-db";

/**
 * Umbrales de alerta, en días respecto del vencimiento.
 * Positivo = días antes. 0 = el día que vence. Negativo = recordatorio
 * posterior para lo que sigue sin renovarse.
 */
const ALERT_THRESHOLDS = [60, 30, 15, 7, 0, -3, -7] as const;

const UMBRALES_ASC = [...ALERT_THRESHOLDS].sort((a, b) => a - b);

/**
 * El umbral que a este documento le toca hoy, o `null` si todavía no le
 * toca ninguno.
 *
 * Devuelve el umbral MÁS CERCANO ya cruzado, no el que coincide exacto con
 * los días que faltan. Antes se comparaba `dias === umbral`, así que la
 * alerta existía un solo día: si el barrido no corría ese día puntual
 * —servidor caído, tarea que no se disparó, cualquier cosa— ese aviso se
 * perdía para siempre y nadie se enteraba de que se había perdido. Un aviso
 * de vencimiento que depende de que un cron no falle nunca no es un aviso.
 *
 * No duplica nada: `AlertaDocumento` ya guarda (trabajador, tipo, fecha,
 * umbral), así que cada umbral se manda una sola vez.
 */
function umbralQueCorresponde(dias: number): number | null {
  return UMBRALES_ASC.find(t => dias <= t) ?? null;
}

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
  // `DOCUMENT_ALERT_EMAILS` manda. Quién debe enterarse de que a un
  // trabajador se le vence un examen es una decisión de la empresa, no una
  // consecuencia de a quién le tocó ser Administrador en la aplicación: con
  // los roles de hoy la lista automática incluía al contador externo.
  //
  // Sin la variable configurada cae a todos los gestores, para que una
  // instalación nueva no quede muda. Pero lo dice en la respuesta.
  const envEmails = (process.env.DOCUMENT_ALERT_EMAILS ?? "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

  const listaExplicita = envEmails.length > 0;

  const gestores = listaExplicita ? [] : await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ["ADMINISTRADOR", "OPERATIVO", "ADMIN", "ADMIN_LIMITADO", "RRHH"] },
    },
    select: { email: true },
  });

  const recipients = listaExplicita
    ? envEmails
    : Array.from(new Set(gestores.map(u => u.email).filter(Boolean)));

  if (recipients.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "Sin destinatarios: configura DOCUMENT_ALERT_EMAILS o crea usuarios Administrador/Operativo",
    }, { status: 400 });
  }

  // ── Documentos vigentes de trabajadores activos ──────────────────────
  const staff = await db.staffMember.findMany({
    where: { isActive: true },
    select: {
      id: true, fullName: true, camp: { select: { name: true } },
      cargoId: true, proyectoId: true,
      contractIsIndefinite: true, trabajoPrevioMandante: true, contractEndDate: true,
    },
  });
  const staffById = new Map(staff.map(s => [s.id, s]));

  if (staff.length === 0) {
    return NextResponse.json({ ok: true, dryRun, aviso: "No hay trabajadores activos" });
  }

  const tipos = await getTiposDocumento();
  if (tipos.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "El catálogo de tipos no está inicializado.",
    }, { status: 400 });
  }

  // El mismo cálculo que las pantallas. Antes este barrido elegía y medía los
  // documentos por su cuenta, y se le escapaban dos cosas que las pantallas
  // sí veían: los tipos declarados perpetuos en el catálogo —seguía avisando
  // el vencimiento de certificados de antecedentes que ya no vencen— y los
  // plazos propios del mandante, como los 36 meses que Transelec le pone al
  // RIOHS. Un aviso que dice algo distinto que la pantalla es un aviso que se
  // deja de creer.
  const { estados } = await getCumplimiento(
    staff.map(s => ({
      id: s.id, proyectoId: s.proyectoId, cargoId: s.cargoId,
      contractIsIndefinite: s.contractIsIndefinite,
      trabajoPrevioMandante: s.trabajoPrevioMandante,
      contractEndDate: s.contractEndDate,
    })),
    tipos,
    today,
  );

  const nombreTipo = new Map(tipos.map(t => [t.id, t.nombre]));
  const noVencePorTipo = new Map(tipos.map(t => [t.id, t.noVence]));
  let documentosVigentes = 0;

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

  for (const [staffMemberId, estado] of estados) {
    const worker = staffById.get(staffMemberId);
    if (!worker) continue;

    for (const entry of estado.porTipo.values()) {
      const doc = entry.documento;
      if (!doc) continue;
      documentosVigentes++;
      if (entry.estado === "sin_vencimiento" || entry.estado === "sin_fecha") continue;

      // Si el estado no sale de las fechas de ESTE documento —el contrato que
      // un anexo posterior extendió—, no se avisa por su fecha: la que manda
      // es la del anexo, y el anexo tiene su propio aviso.
      if (!entry.venceSegunMandante) {
        const propio = calcularEstado(doc, today, UMBRAL_POR_VENCER_DIAS, noVencePorTipo.get(entry.tipoId) ?? false);
        if (propio.estado !== entry.estado || propio.dias !== entry.dias) continue;
      }

      // La fecha del aviso es la que decide: la del mandante si pone plazo,
      // la impresa si no. Para un documento sin plazo del mandante es la misma
      // fecha que se usaba antes, así que los avisos ya enviados se reconocen.
      const dueDate = entry.venceSegunMandante ?? doc.fechaVencimiento;
      if (!dueDate || entry.dias == null) continue;

      const threshold = umbralQueCorresponde(entry.dias);
      if (threshold == null) continue;

      pendientes.push({
        staffMemberId,
        workerName: worker.fullName,
        campName: worker.camp?.name ?? "Sin asignar",
        tipoDocumentoId: entry.tipoId,
        docLabel: nombreTipo.get(entry.tipoId) ?? "Documento",
        dueDate,
        dias: entry.dias,
        threshold,
      });
    }
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
    documentosVigentes,
    umbrales: ALERT_THRESHOLDS,
    destinatarios: listaExplicita
      ? "lista explícita (DOCUMENT_ALERT_EMAILS)"
      : "todos los gestores — configura DOCUMENT_ALERT_EMAILS para acotarla",
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
