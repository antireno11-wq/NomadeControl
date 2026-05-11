import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAlertasVencimiento } from "@/lib/alertas-vencimiento";
import { sendAlertasVencimientoEmail } from "@/lib/mailer";

/** GET /api/alerts/documentos-vencimiento
 *  Cron diario a las 8:00 AM (America/Santiago).
 *  Requiere header  x-cron-secret: $CRON_SECRET
 *  o query param    ?secret=$CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const received =
    request.headers.get("x-cron-secret") ??
    request.nextUrl.searchParams.get("secret");

  if (!secret || received !== secret) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  // ── Dedup: solo un envío por día (fecha UTC) ─────────────────────────────
  const hoy = new Date();
  const targetDate = new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate())
  );
  const alertKind = "documentos-vencimiento";

  const alreadySent = await db.alertDelivery.findUnique({
    where: { kind_targetDate: { kind: alertKind, targetDate } },
  });

  if (alreadySent) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Alerta ya enviada hoy.",
    });
  }

  // ── Consultar todas las alertas urgentes (severidad != ok) ────────────────
  const alertas = await getAlertasVencimiento({ excludeOk: true });

  if (alertas.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "No hay documentos por vencer ni vencidos.",
    });
  }

  // ── Destinatarios: env ALERT_ADMIN_EMAILS o todos los admins activos ──────
  const envRecipients = (process.env.ALERT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const recipients =
    envRecipients.length > 0
      ? envRecipients
      : await db.user
          .findMany({
            where: {
              isActive: true,
              role: { in: ["ADMINISTRADOR", "ADMIN", "ADMIN_LIMITADO"] },
            },
            select: { email: true },
          })
          .then((users) => users.map((u) => u.email));

  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "No hay destinatarios configurados." },
      { status: 400 }
    );
  }

  // ── Formatear fecha para el asunto ────────────────────────────────────────
  const fechaLabel = targetDate.toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // ── Mapear al tipo que espera el mailer ───────────────────────────────────
  const alertasPayload = alertas.map((a) => ({
    severidad: a.severidad as "vencido" | "critico" | "medio" | "preventivo",
    categoria: a.categoria,
    nombre: a.nombre,
    entidad: a.entidad,
    diasRestantes: a.diasRestantes,
    fechaVencimiento: a.fechaVencimiento,
    href: a.href,
  }));

  await sendAlertasVencimientoEmail({
    to: recipients,
    fechaLabel,
    alertas: alertasPayload,
  });

  // ── Registrar entrega ─────────────────────────────────────────────────────
  await db.alertDelivery.create({
    data: {
      kind: alertKind,
      targetDate,
      status: "SENT",
      payload: JSON.stringify({
        recipients,
        counts: {
          vencido:    alertas.filter((a) => a.severidad === "vencido").length,
          critico:    alertas.filter((a) => a.severidad === "critico").length,
          medio:      alertas.filter((a) => a.severidad === "medio").length,
          preventivo: alertas.filter((a) => a.severidad === "preventivo").length,
        },
      }),
    },
  });

  return NextResponse.json({
    ok: true,
    recipients,
    totalAlertas: alertas.length,
    counts: {
      vencido:    alertas.filter((a) => a.severidad === "vencido").length,
      critico:    alertas.filter((a) => a.severidad === "critico").length,
      medio:      alertas.filter((a) => a.severidad === "medio").length,
      preventivo: alertas.filter((a) => a.severidad === "preventivo").length,
    },
  });
}
