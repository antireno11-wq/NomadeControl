import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { sendRequerimientoEmail } from "@/lib/mailer";
import { formatDisplayDate } from "@/lib/report-utils";
import {
  ESTADOS_ABIERTOS, codigoReq, diasHasta, etiquetaSolicitud, postulanteEnProceso,
  prioridadDe, vacantesCubiertas,
} from "@/lib/requerimientos";
import { correosRRHH, registrarEvento } from "@/lib/requerimientos-db";

/** Días antes de la fecha requerida en que se avisa. */
const UMBRAL_DIAS = 7;

/**
 * Alerta de 7 días: solicitudes abiertas a las que les queda una semana o
 * menos para la fecha de ingreso y todavía no cubren sus vacantes.
 *
 * Una vez por fecha requerida: si se corre la fecha, es un plazo nuevo y el
 * aviso vuelve a correr. Llega al solicitante y a RRHH, porque el atraso es
 * de los dos: uno tiene que saber que no va a tener a la gente y el otro que
 * se le está acabando el plazo.
 *
 * Lo llama la tarea "Alertas diarias" de GitHub Actions. Es idempotente: si
 * corre dos veces el mismo día, la segunda no manda nada.
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
  const hoy = new Date();

  const abiertas = await db.requerimiento.findMany({
    where: { estado: { in: ESTADOS_ABIERTOS } },
    select: {
      id: true, numero: true, vacantes: true, fechaRequerida: true, estado: true, prioridad: true,
      solicitanteId: true, solicitanteNombre: true,
      cargo: { select: { nombre: true } },
      proyecto: { select: { nombre: true } },
      postulantes: { select: { estado: true } },
      alertas: { select: { fechaRequerida: true } },
    },
  });

  const porAvisar = abiertas.filter(r =>
    diasHasta(r.fechaRequerida, hoy) <= UMBRAL_DIAS &&
    !r.alertas.some(a => a.fechaRequerida.getTime() === r.fechaRequerida.getTime()),
  );

  const rrhh = porAvisar.length > 0 ? await correosRRHH() : [];
  const solicitantes = new Map(
    (await db.user.findMany({
      where: { id: { in: porAvisar.map(r => r.solicitanteId).filter((x): x is string => Boolean(x)) }, isActive: true },
      select: { id: true, email: true },
    })).map(u => [u.id, u.email.toLowerCase()]),
  );

  const enviados: Array<{ solicitud: string; a: string[]; ok: boolean; error?: string }> = [];

  for (const r of porAvisar) {
    const to = Array.from(new Set([...(r.solicitanteId ? [solicitantes.get(r.solicitanteId)] : []), ...rrhh]))
      .filter((x): x is string => Boolean(x));
    const codigo = codigoReq(r.numero);
    if (to.length === 0) {
      enviados.push({ solicitud: codigo, a: [], ok: false, error: "Sin destinatarios" });
      continue;
    }

    const dias = diasHasta(r.fechaRequerida, hoy);
    const cubiertas = vacantesCubiertas(r.postulantes);
    const enProceso = r.postulantes.filter(p => postulanteEnProceso(p.estado)).length;
    const plazo = dias < 0 ? `venció hace ${-dias} día${dias === -1 ? "" : "s"}` : dias === 0 ? "es hoy" : `es en ${dias} día${dias === 1 ? "" : "s"}`;

    if (dryRun) {
      enviados.push({ solicitud: codigo, a: to, ok: true });
      continue;
    }

    const res = await sendRequerimientoEmail({
      to,
      asunto: `${codigo} · ${r.cargo.nombre}: el ingreso ${plazo} y faltan ${r.vacantes - cubiertas} por contratar`,
      titulo: `${codigo} · ${r.cargo.nombre}`,
      novedades: [
        `La fecha de ingreso (${formatDisplayDate(r.fechaRequerida)}) ${plazo} y quedan ${r.vacantes - cubiertas} de ${r.vacantes} vacante${r.vacantes === 1 ? "" : "s"} sin cubrir.`,
        enProceso > 0
          ? `Hay ${enProceso} postulante${enProceso === 1 ? "" : "s"} en proceso.`
          : "No hay postulantes en proceso.",
      ],
      ficha: [
        ["Proyecto", r.proyecto.nombre],
        ["Estado", etiquetaSolicitud(r.estado)],
        ["Prioridad", prioridadDe(r.prioridad).label],
        ["Solicitante", r.solicitanteNombre],
      ],
      ruta: `/requerimientos/${r.id}`,
    });
    enviados.push({ solicitud: codigo, a: to, ok: res.ok, error: res.error });

    // Solo se marca lo que de verdad salió: si falló, mañana se reintenta.
    if (res.ok) {
      await db.alertaRequerimiento.create({
        data: { requerimientoId: r.id, fechaRequerida: r.fechaRequerida, recipients: to.join(",") },
      }).catch(() => {});
      await registrarEvento({
        requerimientoId: r.id, tipo: "alerta", autorNombre: "Automático",
        detalle: `Aviso de ${UMBRAL_DIAS} días enviado a ${to.join(", ")}`,
      }).catch(() => {});
    }
  }

  if (!dryRun && enviados.some(e => e.ok)) {
    await logAuditEvent({
      actorName: "system-cron", actorEmail: "system@nomadecontrol",
      action: "REQUERIMIENTO_ALERTS_SENT", entityType: "system",
      summary: `Avisó de ${enviados.filter(e => e.ok).length} solicitud(es) a ${UMBRAL_DIAS} días o menos de la fecha de ingreso`,
    }).catch(() => {});
  }

  const fallaron = enviados.filter(e => !e.ok);
  return NextResponse.json({
    // Si un correo falló, la respuesta no es ok: la tarea programada se
    // pone roja y alguien lo mira.
    ok: fallaron.length === 0,
    dryRun,
    revisadas: abiertas.length,
    avisadas: enviados.filter(e => e.ok).length,
    enviados,
  }, { status: fallaron.length === 0 ? 200 : 500 });
}

export const GET = POST;
