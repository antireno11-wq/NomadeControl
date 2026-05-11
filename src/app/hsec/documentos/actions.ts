"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, HSEC_ROLES, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";

export async function createDocumentoHSECAction(formData: FormData) {
  const user = await requireRole(HSEC_ROLES);

  const tipo = String(formData.get("tipo") ?? "").trim();
  const nombre = String(formData.get("nombre") ?? "").trim();
  const fechaEmisionRaw = String(formData.get("fechaEmision") ?? "").trim();
  const fechaVencimientoRaw = String(formData.get("fechaVencimiento") ?? "").trim();
  const responsable = String(formData.get("responsable") ?? "").trim() || null;
  const notas = String(formData.get("notas") ?? "").trim() || null;
  const file = formData.get("file") as File | null;

  // Determine campId — non-admins are always scoped to their own camp
  let campId = String(formData.get("campId") ?? "").trim();
  if (!isAdminRole(user.role) && user.campId) {
    campId = user.campId;
  }

  if (!campId || !tipo || !nombre) {
    redirect("/hsec/documentos?status=invalid");
  }

  let contenido: Buffer | null = null;
  let originalFilename: string | null = null;
  let fileSize: number | null = null;
  let mimeType: string | null = null;

  if (file && file.size > 0) {
    const arrayBuffer = await file.arrayBuffer();
    contenido = Buffer.from(arrayBuffer);
    originalFilename = file.name;
    fileSize = file.size;
    mimeType = file.type || "application/octet-stream";
  }

  const fechaEmision = fechaEmisionRaw ? new Date(fechaEmisionRaw) : null;
  const fechaVencimiento = fechaVencimientoRaw ? new Date(fechaVencimientoRaw) : null;

  await db.documentoHSEC.create({
    data: {
      campId,
      tipo,
      nombre,
      contenido,
      originalFilename,
      fileSize,
      mimeType,
      fechaEmision,
      fechaVencimiento,
      responsable,
      notas,
      creadoPorNombre: user.name,
    },
  });

  revalidatePath("/hsec/documentos");
  redirect(`/hsec/documentos?campId=${campId}&status=created`);
}

export async function deleteDocumentoHSECAction(formData: FormData) {
  await requireRole(HSEC_ROLES);

  const docId = String(formData.get("docId") ?? "").trim();
  if (!docId) redirect("/hsec/documentos?status=invalid");

  await db.documentoHSEC.delete({ where: { id: docId } });

  redirect("/hsec/documentos?status=deleted");
}
