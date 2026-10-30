import { db } from "@/lib/db";
import { isAdminRole, parseModulePermissions } from "@/lib/auth";
import { sendRequerimientoEmail } from "@/lib/mailer";
import { formatDisplayDate } from "@/lib/report-utils";
import {
  codigoReq, estadoCalculado, etiquetaSolicitud, prioridadDe, vacantesCubiertas,
  type EstadoSolicitud,
} from "@/lib/requerimientos";

/**
 * Correos de RRHH: usuarios activos con la casilla "Reclutamiento (RRHH)".
 *
 * Si nadie la tiene, van a los administradores. Una solicitud que no le
 * llega a nadie es peor que un correo de más: el líder cree que RRHH ya está
 * buscando y nadie se enteró.
 */
export async function correosRRHH(excepto?: string | null): Promise<string[]> {
  const usuarios = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, email: true, role: true, modulePermissions: true },
  });
  const rrhh = usuarios.filter(u => parseModulePermissions(u.modulePermissions).includes("reclutamiento"));
  const lista = rrhh.length > 0 ? rrhh : usuarios.filter(u => isAdminRole(u.role));
  return lista.filter(u => u.id !== excepto).map(u => u.email.toLowerCase());
}

async function correoSolicitante(solicitanteId: string | null, excepto?: string | null): Promise<string[]> {
  if (!solicitanteId || solicitanteId === excepto) return [];
  const u = await db.user.findUnique({ where: { id: solicitanteId }, select: { email: true, isActive: true } });
  return u?.isActive ? [u.email.toLowerCase()] : [];
}

export async function registrarEvento(data: {
  requerimientoId: string;
  postulanteId?: string | null;
  tipo: string;
  estadoAnterior?: string | null;
  estadoNuevo?: string | null;
  detalle?: string | null;
  autorId?: string | null;
  autorNombre: string;
}) {
  await db.requerimientoEvento.create({ data });
}

/**
 * Lleva la solicitud al estado que le corresponde por sus postulantes y deja
 * el cambio en el historial. Devuelve el cambio para que quien llama lo
 * incluya en el aviso, o `null` si no hubo.
 */
export async function sincronizarEstado(
  requerimientoId: string,
): Promise<{ anterior: string; nuevo: EstadoSolicitud } | null> {
  const req = await db.requerimiento.findUnique({
    where: { id: requerimientoId },
    select: { estado: true, vacantes: true, postulantes: { select: { estado: true } } },
  });
  if (!req) return null;

  const nuevo = estadoCalculado(req.estado, req.vacantes, req.postulantes);
  if (!nuevo) return null;

  await db.requerimiento.update({
    where: { id: requerimientoId },
    data: { estado: nuevo, contratadoEn: nuevo === "contratado" ? new Date() : null },
  });
  await registrarEvento({
    requerimientoId, tipo: "estado", estadoAnterior: req.estado, estadoNuevo: nuevo,
    autorNombre: "Automático",
    detalle: nuevo === "contratado" ? "Se cubrieron todas las vacantes"
      : req.estado === "contratado" ? "Quedó una vacante sin cubrir"
      : "Por el avance de los postulantes",
  });
  return { anterior: req.estado, nuevo };
}

export function textoCambio(c: { anterior: string; nuevo: string }): string {
  return `La solicitud pasó de «${etiquetaSolicitud(c.anterior)}» a «${etiquetaSolicitud(c.nuevo)}».`;
}

/**
 * Manda un aviso de la solicitud al solicitante o a RRHH.
 *
 * Nunca a quien hizo el cambio: avisarle a alguien de lo que él mismo acaba
 * de hacer es la forma más rápida de que deje de leer estos correos.
 *
 * No interrumpe la acción si falla, pero tampoco lo calla: deja la falla en
 * el historial de la solicitud, donde RRHH la ve.
 */
export async function avisar(
  requerimientoId: string,
  destino: "solicitante" | "rrhh",
  novedades: string[],
  actorId: string | null,
): Promise<void> {
  if (novedades.length === 0) return;
  try {
    const req = await db.requerimiento.findUnique({
      where: { id: requerimientoId },
      select: {
        id: true, numero: true, vacantes: true, estado: true, fechaRequerida: true,
        prioridad: true, solicitanteId: true, solicitanteNombre: true,
        cargo: { select: { nombre: true } },
        proyecto: { select: { nombre: true } },
        postulantes: { select: { estado: true } },
      },
    });
    if (!req) return;

    const to = destino === "rrhh"
      ? await correosRRHH(actorId)
      : await correoSolicitante(req.solicitanteId, actorId);
    if (to.length === 0) return;

    const codigo = codigoReq(req.numero);
    const r = await sendRequerimientoEmail({
      to,
      asunto: `${codigo} · ${req.cargo.nombre}: ${novedades[0]}`.slice(0, 180),
      titulo: `${codigo} · ${req.cargo.nombre}`,
      novedades,
      ficha: [
        ["Proyecto", req.proyecto.nombre],
        ["Vacantes", `${vacantesCubiertas(req.postulantes)} de ${req.vacantes} cubiertas`],
        ["Fecha requerida", formatDisplayDate(req.fechaRequerida)],
        ["Prioridad", prioridadDe(req.prioridad).label],
        ["Estado", etiquetaSolicitud(req.estado)],
        ["Solicitante", req.solicitanteNombre],
      ],
      ruta: `/requerimientos/${req.id}`,
    });
    if (!r.ok) {
      await registrarEvento({
        requerimientoId, tipo: "alerta", autorNombre: "Automático",
        detalle: `No se pudo enviar el aviso a ${to.join(", ")}: ${r.error ?? "error desconocido"}`,
      });
    }
  } catch (e) {
    await registrarEvento({
      requerimientoId, tipo: "alerta", autorNombre: "Automático",
      detalle: `No se pudo enviar el aviso: ${e instanceof Error ? e.message : "error desconocido"}`,
    }).catch(() => {});
  }
}
