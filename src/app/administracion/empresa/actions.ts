"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

const MAX_MB = 18;

/**
 * Carga un documento de la empresa.
 *
 * Append-only, igual que los del trabajador: renovar es una fila nueva y la
 * anterior queda como historial. Ante un reclamo del mandante hay que poder
 * mostrar qué se tenía cargado en cada momento, no solo lo último.
 */
export async function subirDocumentoEmpresaAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);

  const tipoDocumentoId = String(formData.get("tipoDocumentoId") ?? "");
  const emisionRaw = String(formData.get("fechaEmision") ?? "").trim();
  const vencimientoRaw = String(formData.get("fechaVencimiento") ?? "").trim();
  const sinVencimiento = formData.get("sinVencimiento") === "on";
  const archivo = formData.get("archivo");

  if (!tipoDocumentoId) redirect("/administracion/empresa?status=invalido");

  const tipo = await db.tipoDocumento.findUnique({
    where: { id: tipoDocumentoId },
    select: { id: true, nombre: true, noVence: true, vigenciaDias: true },
  });
  if (!tipo) redirect("/administracion/empresa?status=invalido");

  const aFecha = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  };

  const fechaEmision = aFecha(emisionRaw);
  let fechaVencimiento = aFecha(vencimientoRaw);
  let calculado = false;

  // Misma regla que en la ficha del trabajador: si el tipo tiene vigencia por
  // defecto y el documento no trae vencimiento, se deriva de la emisión y
  // queda marcado como calculado.
  if (!fechaVencimiento && fechaEmision && tipo.vigenciaDias && tipo.vigenciaDias > 0) {
    fechaVencimiento = new Date(fechaEmision.getTime() + tipo.vigenciaDias * 86_400_000);
    calculado = true;
  }

  const noVence = sinVencimiento || tipo.noVence;
  if (!fechaVencimiento && !noVence) {
    redirect("/administracion/empresa?status=sin-fecha");
  }

  let archivoId: string | null = null;
  let originalFilename: string | null = null;

  if (archivo instanceof File && archivo.size > 0) {
    if (archivo.size > MAX_MB * 1024 * 1024) {
      redirect("/administracion/empresa?status=pesado");
    }
    const creado = await db.archivoAcreditacion.create({
      data: {
        contenido: Buffer.from(await archivo.arrayBuffer()),
        originalFilename: archivo.name,
        mimeType: archivo.type || "application/octet-stream",
        fileSize: archivo.size,
        subidoPorNombre: user.name,
      },
      select: { id: true },
    });
    archivoId = creado.id;
    originalFilename = archivo.name;
  }

  await db.documentoEmpresa.create({
    data: {
      tipoDocumentoId,
      fechaEmision,
      fechaVencimiento: noVence ? null : fechaVencimiento,
      sinVencimiento: noVence,
      vencimientoCalculado: calculado,
      archivoId,
      originalFilename,
      subidoPorNombre: user.name,
    },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "DOCUMENTO_EMPRESA_UPLOAD",
    entityType: "documentoEmpresa",
    summary: `Cargó el documento de empresa «${tipo.nombre}»`,
  }).catch(() => {});

  revalidatePath("/administracion/empresa");
  redirect("/administracion/empresa?status=ok");
}

/** Anula un documento cargado por error. No se borra: queda el rastro. */
export async function anularDocumentoEmpresaAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);
  const id = String(formData.get("documentoId") ?? "");
  if (!id) redirect("/administracion/empresa?status=invalido");

  await db.documentoEmpresa.update({ where: { id }, data: { anulado: true } });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "DOCUMENTO_EMPRESA_ANULAR",
    entityType: "documentoEmpresa",
    entityId: id,
    summary: "Anuló un documento de empresa",
  }).catch(() => {});

  revalidatePath("/administracion/empresa");
  redirect("/administracion/empresa?status=anulado");
}
