"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, TAREAS_ROLES } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

const TareaSchema = z.object({
  tipo:        z.string().default("compromiso"),
  proyecto:    z.string().optional(),
  area:        z.string().optional(),
  descripcion: z.string().min(1, "La descripción es obligatoria"),
  responsable: z.string().optional(),
  comentario:  z.string().optional(),
  prioridad:   z.enum(["alta", "media", "baja"]).default("media"),
  estado:      z.enum(["pendiente", "en_progreso", "completada", "cancelada"]).default("pendiente"),
  fechaInicio: z.string().optional(),
  fechaCierre: z.string().optional(),
});

function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function crearTareaAction(formData: FormData) {
  const user = await requireRole(TAREAS_ROLES);
  const raw = Object.fromEntries(formData.entries());
  const parsed = TareaSchema.safeParse(raw);
  if (!parsed.success) redirect("/gestion-tareas?status=invalid");

  const d = parsed.data;
  const tarea = await db.tarea.create({
    data: {
      tipo:        d.tipo,
      proyecto:    d.proyecto || null,
      area:        d.area || null,
      descripcion: d.descripcion,
      responsable: d.responsable || null,
      comentario:  d.comentario || null,
      prioridad:   d.prioridad,
      estado:      d.estado,
      fechaInicio: parseDate(d.fechaInicio),
      fechaCierre: parseDate(d.fechaCierre),
      creadoPor:   user.name,
    }
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "TAREA_CREATE", entityType: "tarea", entityId: tarea.id,
    summary: `Creó tarea «${tarea.descripcion.slice(0, 60)}»`
  });

  revalidatePath("/gestion-tareas");
  redirect("/gestion-tareas?status=created");
}

export async function editarTareaAction(tareaId: string, formData: FormData) {
  const user = await requireRole(TAREAS_ROLES);
  const raw = Object.fromEntries(formData.entries());
  const parsed = TareaSchema.safeParse(raw);
  if (!parsed.success) redirect("/gestion-tareas?status=invalid");

  const d = parsed.data;
  const tarea = await db.tarea.update({
    where: { id: tareaId },
    data: {
      tipo:        d.tipo,
      proyecto:    d.proyecto || null,
      area:        d.area || null,
      descripcion: d.descripcion,
      responsable: d.responsable || null,
      comentario:  d.comentario || null,
      prioridad:   d.prioridad,
      estado:      d.estado,
      fechaInicio: parseDate(d.fechaInicio),
      fechaCierre: parseDate(d.fechaCierre),
    }
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "TAREA_UPDATE", entityType: "tarea", entityId: tarea.id,
    summary: `Editó tarea «${tarea.descripcion.slice(0, 60)}»`
  });

  revalidatePath("/gestion-tareas");
  redirect("/gestion-tareas?status=updated");
}

export async function cambiarEstadoTareaAction(tareaId: string, estado: string) {
  const user = await requireRole(TAREAS_ROLES);
  await db.tarea.update({ where: { id: tareaId }, data: { estado } });
  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "TAREA_ESTADO", entityType: "tarea", entityId: tareaId,
    summary: `Cambió estado a «${estado}»`
  });
  revalidatePath("/gestion-tareas");
}

export async function reasignarTareaAction(tareaId: string, nuevoResponsable: string) {
  const user = await requireRole(TAREAS_ROLES);
  await db.tarea.update({ where: { id: tareaId }, data: { responsable: nuevoResponsable } });
  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "TAREA_REASIGNAR", entityType: "tarea", entityId: tareaId,
    summary: `Reasignó tarea a ${nuevoResponsable}`
  });
  revalidatePath("/gestion-tareas");
}

export async function eliminarTareaAction(tareaId: string) {
  const user = await requireRole(TAREAS_ROLES);
  const tarea = await db.tarea.findUnique({ where: { id: tareaId } });
  await db.tarea.delete({ where: { id: tareaId } });
  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "TAREA_DELETE", entityType: "tarea", entityId: tareaId,
    summary: `Eliminó tarea «${tarea?.descripcion?.slice(0, 60)}»`
  });
  revalidatePath("/gestion-tareas");
}
