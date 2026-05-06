"use server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function agregarProyectoAction(fd: FormData) {
  await requireRole(ADMIN_ROLES);
  const nombre = z.string().min(1).max(80).parse((fd.get("nombre") as string)?.trim());
  await (db as any).proyectoConfig.upsert({
    where: { nombre },
    create: { nombre, isActive: true },
    update: { isActive: true },
  });
  revalidatePath("/administracion/configuracion");
  revalidatePath("/gestion-tareas");
}

export async function toggleProyectoAction(id: string, isActive: boolean) {
  await requireRole(ADMIN_ROLES);
  await (db as any).proyectoConfig.update({ where: { id }, data: { isActive } });
  revalidatePath("/administracion/configuracion");
  revalidatePath("/gestion-tareas");
}

export async function agregarAreaAction(fd: FormData) {
  await requireRole(ADMIN_ROLES);
  const nombre = z.string().min(1).max(80).parse((fd.get("nombre") as string)?.trim());
  await (db as any).areaConfig.upsert({
    where: { nombre },
    create: { nombre, isActive: true },
    update: { isActive: true },
  });
  revalidatePath("/administracion/configuracion");
  revalidatePath("/gestion-tareas");
}

export async function toggleAreaAction(id: string, isActive: boolean) {
  await requireRole(ADMIN_ROLES);
  await (db as any).areaConfig.update({ where: { id }, data: { isActive } });
  revalidatePath("/administracion/configuracion");
  revalidatePath("/gestion-tareas");
}
