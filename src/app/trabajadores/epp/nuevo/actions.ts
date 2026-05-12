"use server";

import { redirect } from "next/navigation";
import { requireRole, TRABAJADORES_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function registrarEntregaEPPAction(formData: FormData) {
  await requireRole(TRABAJADORES_ROLES);

  const staffMemberId = String(formData.get("staffMemberId") ?? "").trim();
  const tipoEppId = String(formData.get("tipoEppId") ?? "").trim();
  const cantidad = parseInt(String(formData.get("cantidad") ?? "1"));
  const fechaEntrega = String(formData.get("fechaEntrega") ?? "");
  const fechaVencimiento = String(formData.get("fechaVencimiento") ?? "");
  const campId = String(formData.get("campId") ?? "").trim() || null;
  const entregadoPorId = String(formData.get("entregadoPorId") ?? "");
  const observaciones = String(formData.get("observaciones") ?? "").trim() || null;

  if (!staffMemberId || !tipoEppId || !fechaEntrega || !fechaVencimiento) {
    redirect("/trabajadores/epp/nuevo?error=campos");
  }

  const trabajador = await db.staffMember.findUnique({ where: { id: staffMemberId } });
  if (!trabajador) redirect("/trabajadores/epp/nuevo?error=trabajador");

  await db.entregaEPP.create({
    data: {
      staffMemberId,
      nombreTrabajador: trabajador!.fullName,
      tipoEppId,
      cantidad,
      fechaEntrega: new Date(fechaEntrega),
      fechaVencimiento: new Date(fechaVencimiento),
      campId,
      entregadoPorId,
      observaciones,
    },
  });

  redirect("/trabajadores/epp?status=created");
}
