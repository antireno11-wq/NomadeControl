"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, TRABAJADORES_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function createDocumentoTrabajadorAction(formData: FormData) {
  const user = await requireRole(TRABAJADORES_ROLES);

  const staffMemberId = String(formData.get("staffMemberId") ?? "").trim();
  const tipo = String(formData.get("tipo") ?? "").trim();
  const nombre = String(formData.get("nombre") ?? "").trim();
  const fechaEmisionRaw = String(formData.get("fechaEmision") ?? "").trim();
  const fechaVencimientoRaw = String(formData.get("fechaVencimiento") ?? "").trim();
  const notas = String(formData.get("notas") ?? "").trim() || null;
  const file = formData.get("file") as File | null;

  if (!staffMemberId || !tipo || !nombre) {
    redirect(`/trabajadores/${staffMemberId}/documentos?status=invalid`);
  }

  const worker = await db.staffMember.findUnique({ where: { id: staffMemberId } });
  if (!worker) {
    redirect(`/trabajadores?status=notfound`);
  }

  let contenido: Buffer | undefined;
  let originalFilename: string | undefined;
  let fileSize: number | undefined;
  let mimeType: string | undefined;

  if (file && file.size > 0) {
    contenido = Buffer.from(await file.arrayBuffer());
    originalFilename = file.name;
    fileSize = file.size;
    mimeType = file.type || "application/octet-stream";
  }

  const fechaEmision = fechaEmisionRaw ? new Date(fechaEmisionRaw) : undefined;
  const fechaVencimiento = fechaVencimientoRaw ? new Date(fechaVencimientoRaw) : undefined;

  await db.documentoTrabajador.create({
    data: {
      staffMemberId,
      tipo,
      nombre,
      contenido,
      originalFilename,
      fileSize,
      mimeType,
      fechaEmision,
      fechaVencimiento,
      notas,
      creadoPorNombre: user.name,
    },
  });

  revalidatePath(`/trabajadores/${staffMemberId}`);
  revalidatePath(`/trabajadores/${staffMemberId}/documentos`);
  redirect(`/trabajadores/${staffMemberId}/documentos?status=created`);
}

export async function deleteDocumentoTrabajadorAction(formData: FormData) {
  await requireRole(TRABAJADORES_ROLES);

  const docId = String(formData.get("docId") ?? "").trim();
  const staffMemberId = String(formData.get("staffMemberId") ?? "").trim();

  if (!docId || !staffMemberId) {
    redirect(`/trabajadores/${staffMemberId}/documentos?status=invalid`);
  }

  await db.documentoTrabajador.delete({ where: { id: docId } });

  revalidatePath(`/trabajadores/${staffMemberId}`);
  revalidatePath(`/trabajadores/${staffMemberId}/documentos`);
  redirect(`/trabajadores/${staffMemberId}/documentos?status=deleted`);
}
