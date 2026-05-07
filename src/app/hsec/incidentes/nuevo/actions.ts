"use server";

import { redirect } from "next/navigation";
import { requireRole, HSEC_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function crearIncidenteAction(formData: FormData) {
  await requireRole(HSEC_ROLES);

  const titulo = String(formData.get("titulo") ?? "").trim();
  const descripcion = String(formData.get("descripcion") ?? "").trim();
  const fechaOcurrencia = String(formData.get("fechaOcurrencia") ?? "");
  const lugar = String(formData.get("lugar") ?? "").trim();
  const area = String(formData.get("area") ?? "").trim() || null;
  const criticidad = String(formData.get("criticidad") ?? "");
  const responsableId = String(formData.get("responsableId") ?? "").trim() || null;
  const campId = String(formData.get("campId") ?? "").trim() || null;
  const incumplimientoLegal = formData.get("incumplimientoLegal") === "true";
  const planAccion = String(formData.get("planAccion") ?? "").trim() || null;
  const reportadoPorId = String(formData.get("reportadoPorId") ?? "");

  if (!titulo || !descripcion || !fechaOcurrencia || !lugar || !criticidad || !reportadoPorId) {
    redirect("/hsec/incidentes/nuevo?error=campos");
  }

  const incidente = await db.incidente.create({
    data: {
      titulo,
      descripcion,
      fechaOcurrencia: new Date(fechaOcurrencia),
      lugar,
      area,
      criticidad,
      responsableId,
      campId,
      incumplimientoLegal,
      planAccion,
      reportadoPorId,
    },
  });

  redirect(`/hsec/incidentes/${incidente.id}?status=created`);
}
