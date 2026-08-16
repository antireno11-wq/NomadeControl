"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ADMIN_ROLES, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

/**
 * Catálogo de calificaciones.
 *
 * Una calificación es una habilitación que la persona tiene ADEMÁS de su
 * cargo: Emanuel es montajista y además rigger. No se modela como cargo
 * porque entonces habría que duplicar la matriz completa de montajista, y
 * crear un cargo más cada vez que alguien saque un carnet nuevo.
 */

export async function crearCalificacionAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);

  const nombre = String(formData.get("nombre") ?? "").trim();
  const descripcion = String(formData.get("descripcion") ?? "").trim() || null;
  if (nombre.length < 3) redirect("/administracion/calificaciones?status=nombre-corto");

  // Chocar por nombre repetido no es un error del usuario: la calificación ya
  // existe y quizá solo estaba desactivada.
  const existente = await db.calificacion.findUnique({ where: { nombre } });
  if (existente) {
    if (!existente.activo) {
      await db.calificacion.update({ where: { id: existente.id }, data: { activo: true } });
      revalidatePath("/administracion/calificaciones");
      redirect("/administracion/calificaciones?status=reactivada");
    }
    redirect("/administracion/calificaciones?status=repetida");
  }

  const creada = await db.calificacion.create({
    data: { nombre, descripcion, orden: 100 },
    select: { id: true },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "CALIFICACION_CREAR", entityType: "calificacion", entityId: creada.id,
    summary: `Creó la calificación «${nombre}»`,
  }).catch(() => {});

  revalidatePath("/administracion/calificaciones");
  redirect("/administracion/calificaciones?status=creada");
}

export async function actualizarCalificacionAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);

  const id = String(formData.get("id") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();
  const descripcion = String(formData.get("descripcion") ?? "").trim() || null;
  if (!id || nombre.length < 3) redirect("/administracion/calificaciones?status=nombre-corto");

  await db.calificacion.update({ where: { id }, data: { nombre, descripcion } });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "CALIFICACION_EDITAR", entityType: "calificacion", entityId: id,
    summary: `Editó la calificación «${nombre}»`,
  }).catch(() => {});

  revalidatePath("/administracion/calificaciones");
  redirect("/administracion/calificaciones?status=guardada");
}

/**
 * Desactiva o reactiva. Nunca borra: si alguien tiene la calificación, sus
 * documentos se le pidieron por eso, y borrarla dejaría esos requisitos sin
 * explicación en el historial.
 */
export async function alternarCalificacionAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/administracion/calificaciones?status=invalida");

  const actual = await db.calificacion.findUnique({
    where: { id }, select: { activo: true, nombre: true },
  });
  if (!actual) redirect("/administracion/calificaciones?status=invalida");

  await db.calificacion.update({ where: { id }, data: { activo: !actual.activo } });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "CALIFICACION_ALTERNAR", entityType: "calificacion", entityId: id,
    summary: `${actual.activo ? "Desactivó" : "Reactivó"} la calificación «${actual.nombre}»`,
  }).catch(() => {});

  revalidatePath("/administracion/calificaciones");
  redirect("/administracion/calificaciones?status=guardada");
}

/**
 * Marca las calificaciones de un trabajador desde su ficha.
 *
 * Lo hace Operativo y no solo Administrador: quién tiene el carnet es un dato
 * del día a día de control documental, distinto de definir qué calificaciones
 * existen, que sí es configuración.
 */
export async function asignarCalificacionesAction(formData: FormData) {
  const user = await requireRole(TRABAJADORES_ROLES);

  const workerId = String(formData.get("workerId") ?? "");
  if (!workerId) redirect("/trabajadores");

  const ids = formData.getAll("calificaciones").map(String).filter(Boolean);

  await db.staffMember.update({
    where: { id: workerId },
    data: { calificaciones: { set: ids.map(id => ({ id })) } },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "TRABAJADOR_CALIFICACIONES", entityType: "staffMember", entityId: workerId,
    summary: `Actualizó las calificaciones del trabajador (${ids.length})`,
  }).catch(() => {});

  revalidatePath(`/trabajadores/${workerId}`);
  redirect(`/trabajadores/${workerId}?tab=documentos&status=calificaciones-ok`);
}
