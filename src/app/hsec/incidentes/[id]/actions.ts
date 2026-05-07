"use server";

import { redirect } from "next/navigation";
import { requireRole, HSEC_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function actualizarIncidenteAction(formData: FormData) {
  await requireRole(HSEC_ROLES);

  const id = String(formData.get("id") ?? "");
  const estado = String(formData.get("estado") ?? "");
  const responsableId = String(formData.get("responsableId") ?? "").trim() || null;
  const planAccion = String(formData.get("planAccion") ?? "").trim() || null;

  await db.incidente.update({
    where: { id },
    data: {
      estado,
      responsableId,
      planAccion,
      fechaCierre: estado === "cerrado" ? new Date() : null,
    },
  });

  redirect(`/hsec/incidentes/${id}?status=updated`);
}
