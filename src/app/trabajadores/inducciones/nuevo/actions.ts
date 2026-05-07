"use server";

import { redirect } from "next/navigation";
import { requireRole, OPERATION_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function asignarInduccionAction(formData: FormData) {
  await requireRole(OPERATION_ROLES);

  const staffMemberId = String(formData.get("staffMemberId") ?? "").trim();
  const cursoId = String(formData.get("cursoId") ?? "").trim();

  if (!staffMemberId || !cursoId) redirect("/trabajadores/inducciones/nuevo?error=campos");

  const trabajador = await db.staffMember.findUnique({ where: { id: staffMemberId } });
  if (!trabajador) redirect("/trabajadores/inducciones/nuevo?error=trabajador");

  // Upsert: si ya existe la deja en pendiente, si no crea nueva
  const existente = await db.induccionUsuario.findFirst({ where: { staffMemberId, cursoId } });
  if (existente) {
    redirect(`/trabajadores/inducciones/${existente.id}?status=exists`);
  }

  const induccion = await db.induccionUsuario.create({
    data: {
      staffMemberId,
      nombreTrabajador: trabajador.fullName,
      cursoId,
      estado: "pendiente",
    },
  });

  redirect(`/trabajadores/inducciones/${induccion.id}?status=created`);
}
