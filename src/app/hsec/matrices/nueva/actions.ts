"use server";

import { redirect } from "next/navigation";
import { requireRole, HSEC_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

function calcularNivel(prob: number, impacto: number): string {
  const score = prob * impacto;
  if (score >= 20) return "critico";
  if (score >= 12) return "alto";
  if (score >= 6) return "medio";
  return "bajo";
}

export async function crearMatrizAction(formData: FormData) {
  await requireRole(HSEC_ROLES);

  const tarea = String(formData.get("tarea") ?? "").trim();
  const area = String(formData.get("area") ?? "").trim();
  const peligro = String(formData.get("peligro") ?? "").trim();
  const probabilidad = parseInt(String(formData.get("probabilidad") ?? "0"));
  const impacto = parseInt(String(formData.get("impacto") ?? "0"));
  const medidasControl = String(formData.get("medidasControl") ?? "").trim() || null;
  const responsableId = String(formData.get("responsableId") ?? "").trim();
  const fechaRevisionStr = String(formData.get("fechaRevision") ?? "").trim();
  const campId = String(formData.get("campId") ?? "").trim() || null;

  if (!tarea || !area || !peligro || !probabilidad || !impacto || !responsableId) {
    redirect("/hsec/matrices/nueva?error=campos");
  }

  const nivelRiesgo = calcularNivel(probabilidad, impacto);

  await db.matrizRiesgo.create({
    data: {
      tarea,
      area,
      peligro,
      probabilidad,
      impacto,
      nivelRiesgo,
      medidasControl,
      responsableId,
      campId,
      fechaRevision: fechaRevisionStr ? new Date(fechaRevisionStr) : null,
    },
  });

  redirect("/hsec/matrices?status=created");
}
