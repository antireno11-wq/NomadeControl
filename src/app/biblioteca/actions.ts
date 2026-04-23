"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, BIBLIOTECA_ROLES } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

export async function subirDocumentoAction(formData: FormData) {
  const user = await requireRole(BIBLIOTECA_ROLES);

  const titulo = (formData.get("titulo") as string)?.trim();
  const descripcion = (formData.get("descripcion") as string)?.trim() || null;
  const categoria = (formData.get("categoria") as string)?.trim();
  const version = (formData.get("version") as string)?.trim() || null;
  const archivo = formData.get("archivo") as File | null;

  if (!titulo || !categoria || !archivo || archivo.size === 0) {
    redirect("/biblioteca?status=invalid");
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());

  const doc = await db.documento.create({
    data: {
      titulo,
      descripcion,
      categoria,
      version,
      originalFilename: archivo.name,
      fileSize: archivo.size,
      mimeType: archivo.type || "application/octet-stream",
      contenido: buffer,
      subidoPor: user.name,
    },
  });

  await logAuditEvent({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "DOCUMENTO_UPLOAD",
    entityType: "documento",
    entityId: doc.id,
    summary: `Subió documento «${titulo}» (${categoria})`,
  });

  revalidatePath("/biblioteca");
  redirect("/biblioteca?status=uploaded");
}

export async function eliminarDocumentoAction(docId: string) {
  const user = await requireRole(BIBLIOTECA_ROLES);

  const doc = await db.documento.findUnique({ where: { id: docId } });
  if (!doc) redirect("/biblioteca?status=notfound");

  await db.documento.delete({ where: { id: docId } });

  await logAuditEvent({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "DOCUMENTO_DELETE",
    entityType: "documento",
    entityId: docId,
    summary: `Eliminó documento «${doc.titulo}»`,
  });

  revalidatePath("/biblioteca");
}
