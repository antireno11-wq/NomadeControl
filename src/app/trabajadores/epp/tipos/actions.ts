"use server";

import { redirect } from "next/navigation";
import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function crearTipoEPPAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);
  const nombre = String(formData.get("nombre") ?? "").trim();
  const descripcion = String(formData.get("descripcion") ?? "").trim() || null;
  const vigenciaDias = parseInt(String(formData.get("vigenciaDias") ?? "365"));
  if (!nombre) redirect("/trabajadores/epp/tipos?error=campos");
  await db.tipoEPP.create({ data: { nombre, descripcion, vigenciaDias } });
  redirect("/trabajadores/epp/tipos?status=created");
}

export async function toggleTipoEPPAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);
  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("isActive") === "true";
  await db.tipoEPP.update({ where: { id }, data: { isActive } });
  redirect("/trabajadores/epp/tipos?status=updated");
}
