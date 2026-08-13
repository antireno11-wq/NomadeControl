"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

/**
 * Correcciones sobre un documento de acreditación.
 *
 * El modelo es append-only a propósito: nunca se hace UPDATE de fechas. Ante
 * un reclamo del mandante hay que poder mostrar qué decía el sistema el día
 * que se acreditó a la persona, y una fila pisada no permite eso. Corregir
 * escribe una fila nueva y anula la anterior; la anterior queda visible en el
 * historial con quién la anuló y por qué.
 */

function fecha(valor: FormDataEntryValue | null): Date | null {
  const s = String(valor ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Corrige fechas: fila nueva con los datos buenos, la vieja queda anulada. */
export async function corregirDocumentoAction(formData: FormData) {
  const user = await requireRole(TRABAJADORES_ROLES);

  const docId = String(formData.get("docId") ?? "");
  const workerId = String(formData.get("workerId") ?? "");
  if (!docId || !workerId) redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-invalido`);

  const anterior = await db.documentoAcreditacion.findUnique({ where: { id: docId } });
  if (!anterior || anterior.staffMemberId !== workerId) {
    redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-no-encontrado`);
  }

  const sinVencimiento = formData.get("sinVencimiento") === "on";
  const fechaEmision = fecha(formData.get("fechaEmision"));
  const fechaVencimiento = sinVencimiento ? null : fecha(formData.get("fechaVencimiento"));
  const nota = String(formData.get("nota") ?? "").trim() || null;

  // Sin ninguna fecha y sin marcar "no vence", la corrección dejaría el
  // documento peor que antes: se rechaza en vez de guardar un registro mudo.
  if (!sinVencimiento && !fechaVencimiento && !fechaEmision) {
    redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-sin-fecha`);
  }

  await db.$transaction([
    db.documentoAcreditacion.create({
      data: {
        staffMemberId: workerId,
        tipoDocumentoId: anterior.tipoDocumentoId,
        fechaEmision,
        fechaVencimiento,
        sinVencimiento,
        // La fecha la puso una persona mirando el documento: ya no es
        // calculada, y por eso deja de dibujarse con borde punteado.
        vencimientoCalculado: false,
        // El archivo se arrastra tal cual: lo que se corrige es la lectura,
        // no el documento. Perderlo obligaría a volver a subirlo.
        archivoId: anterior.archivoId,
        archivoUrl: anterior.archivoUrl,
        archivoHash: anterior.archivoHash,
        originalFilename: anterior.originalFilename,
        fileSize: anterior.fileSize,
        mimeType: anterior.mimeType,
        paginaInicio: anterior.paginaInicio,
        origen: "manual",
        nota,
        confirmadoPorId: user.id,
        confirmadoPorNombre: user.name,
        confirmadoAt: new Date(),
      },
    }),
    db.documentoAcreditacion.update({
      where: { id: docId },
      data: {
        anulado: true,
        anuladoPorNombre: user.name,
        anuladoAt: new Date(),
        motivoAnulacion: "Corregido a mano desde la ficha",
      },
    }),
  ]);

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "DOCUMENTO_CORREGIR", entityType: "documentoAcreditacion", entityId: docId,
    summary: `Corrigió las fechas de un documento de acreditación`,
  }).catch(() => {});

  revalidatePath(`/trabajadores/${workerId}`);
  redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-corregido`);
}

/** Anula un documento sin reemplazarlo. Queda en el historial. */
export async function anularDocumentoAction(formData: FormData) {
  const user = await requireRole(TRABAJADORES_ROLES);

  const docId = String(formData.get("docId") ?? "");
  const workerId = String(formData.get("workerId") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!docId || !workerId) redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-invalido`);

  // Sin motivo, el historial no sirve para nada dentro de tres meses.
  if (motivo.length < 4) {
    redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-sin-motivo`);
  }

  const doc = await db.documentoAcreditacion.findUnique({
    where: { id: docId }, select: { staffMemberId: true },
  });
  if (!doc || doc.staffMemberId !== workerId) {
    redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-no-encontrado`);
  }

  await db.documentoAcreditacion.update({
    where: { id: docId },
    data: {
      anulado: true,
      anuladoPorNombre: user.name,
      anuladoAt: new Date(),
      motivoAnulacion: motivo,
    },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "DOCUMENTO_ANULAR", entityType: "documentoAcreditacion", entityId: docId,
    summary: `Anuló un documento de acreditación: ${motivo}`,
  }).catch(() => {});

  revalidatePath(`/trabajadores/${workerId}`);
  redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-anulado`);
}

/**
 * Registra un documento que existe en papel pero todavía no está en el
 * sistema. Queda sin archivo adjunto y marcado como tal: sirve para no
 * bloquear la acreditación por un dato que ya se conoce, pero se distingue de
 * un documento respaldado.
 */
export async function registrarDocumentoAction(formData: FormData) {
  const user = await requireRole(TRABAJADORES_ROLES);

  const workerId = String(formData.get("workerId") ?? "");
  const tipoId = String(formData.get("tipoId") ?? "");
  if (!workerId || !tipoId) redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-invalido`);

  const sinVencimiento = formData.get("sinVencimiento") === "on";
  const fechaEmision = fecha(formData.get("fechaEmision"));
  const fechaVencimiento = sinVencimiento ? null : fecha(formData.get("fechaVencimiento"));

  if (!sinVencimiento && !fechaVencimiento && !fechaEmision) {
    redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-sin-fecha`);
  }

  await db.documentoAcreditacion.create({
    data: {
      staffMemberId: workerId,
      tipoDocumentoId: tipoId,
      fechaEmision,
      fechaVencimiento,
      sinVencimiento,
      vencimientoCalculado: false,
      origen: "manual",
      nota: String(formData.get("nota") ?? "").trim() || null,
      confirmadoPorId: user.id,
      confirmadoPorNombre: user.name,
      confirmadoAt: new Date(),
    },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "DOCUMENTO_REGISTRAR", entityType: "documentoAcreditacion",
    summary: `Registró a mano un documento sin archivo adjunto`,
  }).catch(() => {});

  revalidatePath(`/trabajadores/${workerId}`);
  redirect(`/trabajadores/${workerId}?tab=documentos&status=doc-registrado`);
}
