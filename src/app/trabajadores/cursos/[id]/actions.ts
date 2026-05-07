"use server";

import { redirect } from "next/navigation";
import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function toggleCursoAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);
  const id = String(formData.get("id") ?? "");
  const activo = formData.get("activo") === "true";
  await db.curso.update({ where: { id }, data: { activo } });
  redirect(`/trabajadores/cursos/${id}?status=updated`);
}
