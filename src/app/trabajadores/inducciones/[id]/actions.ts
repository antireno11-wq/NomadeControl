"use server";

import { redirect } from "next/navigation";
import { requireRole, OPERATION_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function actualizarInduccionAction(formData: FormData) {
  await requireRole(OPERATION_ROLES);

  const id = String(formData.get("id") ?? "");
  const estado = String(formData.get("estado") ?? "");
  const puntajeStr = String(formData.get("puntaje") ?? "").trim();
  const puntaje = puntajeStr ? parseInt(puntajeStr) : null;
  const reglamentoFirmado = formData.get("reglamentoFirmado") === "true";

  await db.induccionUsuario.update({
    where: { id },
    data: {
      estado,
      puntaje,
      reglamentoFirmado,
      fechaCompletado: estado === "completado" ? new Date() : undefined,
      fechaInicio: estado === "en_progreso" ? new Date() : undefined,
      intentos: estado === "reprobado" ? { increment: 1 } : undefined,
    },
  });

  redirect(`/trabajadores/inducciones/${id}?status=updated`);
}
