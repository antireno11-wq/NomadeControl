"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ADMIN_ROLES, requireRole, isAdminRole, type AppRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { deInputDate, semanaIso } from "@/lib/ddd";

const DDD_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

/**
 * Nombre con el que se compara la responsabilidad.
 *
 * El responsable se guarda como texto porque muchos vienen de la
 * transcripción y no todos tienen usuario. Para decidir si alguien puede
 * cerrar SU compromiso se compara el nombre normalizado.
 */
function mismoResponsable(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return norm(a) === norm(b);
}

/**
 * Reunión contenedora de los compromisos dados de alta a mano.
 *
 * Un compromiso siempre nace en una reunión, pero se puede registrar uno
 * suelto sin haber cargado la minuta. Se agrupan por día en una reunión
 * marcada como manual, para no inventar un origen falso ni dejar el campo
 * vacío.
 */
async function reunionParaAltaManual(fecha: Date, autor: string): Promise<string> {
  const { anio, semana } = semanaIso(fecha);
  const existente = await db.reunion.findFirst({
    where: { tipo: "bilateral", fecha, referencia: "Alta manual" },
    select: { id: true },
  });
  if (existente) return existente.id;

  const creada = await db.reunion.create({
    data: {
      tipo: "bilateral", fecha, anio, semanaIso: semana,
      referencia: "Alta manual", estado: "publicada",
      participantes: [], creadaPorNombre: autor,
      resumen: "Compromisos registrados directamente en el tablero.",
    },
    select: { id: true },
  });
  return creada.id;
}

export async function crearCompromisoAction(formData: FormData) {
  const user = await requireRole(DDD_ROLES);

  const accion = String(formData.get("accion") ?? "").trim();
  const responsable = String(formData.get("responsable") ?? "").trim();
  const oportunidad = String(formData.get("oportunidad") ?? "").trim() || "Otro";
  const fechaCierre = deInputDate(String(formData.get("fechaCierre") ?? ""));
  const fechaCaptura = deInputDate(String(formData.get("fechaCaptura") ?? "")) ?? new Date();
  const contratoId = String(formData.get("contratoId") ?? "").trim() || null;
  const observacion = String(formData.get("observacion") ?? "").trim() || null;

  if (accion.length < 4 || !responsable || !fechaCierre) {
    redirect("/compromisos?status=invalido");
  }

  const reunionOrigenId = await reunionParaAltaManual(fechaCaptura, user.name);

  await db.compromiso.create({
    data: {
      reunionOrigenId, fechaCaptura, oportunidad, accion, responsable,
      contratoId, fechaCierre, observacion, origen: "manual",
    },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "COMPROMISO_CREATE", entityType: "compromiso",
    summary: `Registró el compromiso «${accion.slice(0, 60)}» para ${responsable}`,
  }).catch(() => {});

  revalidatePath("/compromisos");
  redirect("/compromisos?status=creado");
}

/**
 * Cierra un compromiso.
 *
 * Operativo solo puede cerrar los suyos. No es burocracia: si cualquiera
 * cierra el compromiso de cualquiera, el indicador de cumplimiento deja de
 * decir nada.
 */
export async function cerrarCompromisoAction(formData: FormData) {
  const user = await requireRole(DDD_ROLES);
  const id = String(formData.get("compromisoId") ?? "");
  if (!id) redirect("/compromisos?status=invalido");

  const compromiso = await db.compromiso.findUnique({
    where: { id }, select: { responsable: true, accion: true, estado: true },
  });
  if (!compromiso) redirect("/compromisos?status=no-encontrado");

  if (!isAdminRole(user.role) && !mismoResponsable(compromiso.responsable, user.name)) {
    redirect("/compromisos?status=ajeno");
  }

  // Cerrar sin decir cómo no es cerrar, es sacarlo de la lista. A los tres
  // meses, ante una pregunta del mandante, un cerrado sin explicación no se
  // distingue de uno que nunca se hizo.
  const observacion = String(formData.get("observacion") ?? "").trim();
  if (observacion.length < 6) {
    redirect("/compromisos?status=sin-cierre");
  }

  await db.compromiso.update({
    where: { id },
    data: {
      estado: 1,
      fechaCierreReal: deInputDate(String(formData.get("fechaCierreReal") ?? "")) ?? new Date(),
      observacion,
      cerradoPorNombre: user.name,
    },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "COMPROMISO_CERRAR", entityType: "compromiso", entityId: id,
    summary: `Cerró el compromiso «${compromiso.accion.slice(0, 60)}»`,
  }).catch(() => {});

  revalidatePath("/compromisos");
  redirect("/compromisos?status=cerrado");
}

/**
 * Reprograma la fecha. Solo Administrador.
 *
 * La fecha de cierre original NUNCA se modifica: se escribe una
 * reprogramación y se actualiza la fecha del segundo compromiso. El
 * historial es el dato que a los tres meses muestra quién compromete fechas
 * que no puede cumplir.
 */
export async function reprogramarCompromisoAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);
  const id = String(formData.get("compromisoId") ?? "");
  const fechaNueva = deInputDate(String(formData.get("fechaNueva") ?? ""));
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (!id || !fechaNueva) redirect("/compromisos?status=invalido");

  const compromiso = await db.compromiso.findUnique({
    where: { id },
    select: { fechaCierre: true, fecha2doCompromiso: true, accion: true },
  });
  if (!compromiso) redirect("/compromisos?status=no-encontrado");

  const fechaAnterior = compromiso.fecha2doCompromiso ?? compromiso.fechaCierre;

  await db.$transaction([
    db.compromisoReprogramacion.create({
      data: {
        compromisoId: id, fechaAnterior, fechaNueva,
        motivo: motivo || null, creadoPorNombre: user.name,
      },
    }),
    db.compromiso.update({ where: { id }, data: { fecha2doCompromiso: fechaNueva } }),
  ]);

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "COMPROMISO_REPROGRAMAR", entityType: "compromiso", entityId: id,
    summary: `Reprogramó «${compromiso.accion.slice(0, 50)}» de ${fechaAnterior.toISOString().slice(0, 10)} a ${fechaNueva.toISOString().slice(0, 10)}`,
  }).catch(() => {});

  revalidatePath("/compromisos");
  redirect("/compromisos?status=reprogramado");
}

/** Reabre un compromiso cerrado por error. Solo Administrador. */
export async function reabrirCompromisoAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);
  const id = String(formData.get("compromisoId") ?? "");
  if (!id) redirect("/compromisos?status=invalido");

  await db.compromiso.update({
    where: { id },
    data: { estado: 0, fechaCierreReal: null, cerradoPorNombre: null },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "COMPROMISO_REABRIR", entityType: "compromiso", entityId: id,
    summary: "Reabrió un compromiso",
  }).catch(() => {});

  revalidatePath("/compromisos");
  redirect("/compromisos?status=reabierto");
}
