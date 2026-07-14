"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, ADMIN_ROLES, type AppRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { extractDocumentInfo, matchWorker, type ExtractedDoc } from "@/lib/document-extractor";
import { STAFF_DOCUMENT_FIELDS, type StaffDocumentFieldKey } from "@/lib/staff-docs";

const STAFF_MANAGER_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

export type ExtractedRow = ExtractedDoc & {
  clientFileId: string;
  fileName: string;
  matches: Array<{ workerId: string; workerName: string; score: number; reason: string }>;
  error?: string;
};

/**
 * Recibe un array de archivos (base64) y los procesa uno por uno con OpenAI.
 * Devuelve una fila enriquecida por archivo, con los mejores candidatos de
 * trabajador que hacen match.
 *
 * No guarda nada en BD — solo devuelve para que el usuario revise y confirme.
 */
export async function extractDocumentsAction(
  files: Array<{ clientFileId: string; fileName: string; mimeType: string; base64: string }>,
): Promise<ExtractedRow[]> {
  await requireRole(STAFF_MANAGER_ROLES);

  // Cargamos los trabajadores activos para el matching
  const workers = await db.staffMember.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, nationalId: true },
  });

  const results: ExtractedRow[] = [];

  for (const file of files) {
    try {
      const extracted = await extractDocumentInfo({
        imageBase64: file.base64,
        mimeType: file.mimeType,
        fileName: file.fileName,
      });

      const matches = matchWorker(
        { name: extracted.workerName, rut: extracted.workerRut },
        workers,
      ).map(m => {
        const w = workers.find(x => x.id === m.workerId)!;
        return {
          workerId: m.workerId,
          workerName: w.fullName,
          score: m.score,
          reason: m.reason,
        };
      });

      results.push({
        clientFileId: file.clientFileId,
        fileName: file.fileName,
        ...extracted,
        matches,
      });
    } catch (e) {
      results.push({
        clientFileId: file.clientFileId,
        fileName: file.fileName,
        detectedDocType: "unknown",
        detectedDocTypeLabel: "Error",
        expiryDate: null,
        issueDate: null,
        workerName: null,
        workerRut: null,
        confidence: "low",
        reasoning: "",
        matches: [],
        error: (e as Error).message,
      });
    }
  }

  return results;
}

/**
 * Aplica las filas confirmadas — actualiza cada trabajador con la fecha de
 * vencimiento correspondiente al tipo de documento detectado.
 */
export async function applyExtractionsAction(
  rows: Array<{
    workerId: string;
    docType: StaffDocumentFieldKey;
    expiryDate: string; // YYYY-MM-DD
  }>,
): Promise<{ applied: number; errors: Array<{ workerId: string; error: string }> }> {
  const user = await requireRole(STAFF_MANAGER_ROLES);

  const validDocTypes = new Set(STAFF_DOCUMENT_FIELDS.map(f => f.key));
  const errors: Array<{ workerId: string; error: string }> = [];
  let applied = 0;

  for (const row of rows) {
    try {
      if (!validDocTypes.has(row.docType)) {
        errors.push({ workerId: row.workerId, error: `Tipo inválido: ${row.docType}` });
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.expiryDate)) {
        errors.push({ workerId: row.workerId, error: `Fecha inválida: ${row.expiryDate}` });
        continue;
      }
      const [y, m, d] = row.expiryDate.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

      await db.staffMember.update({
        where: { id: row.workerId },
        data: { [row.docType]: date },
      });
      applied++;
    } catch (e) {
      errors.push({ workerId: row.workerId, error: (e as Error).message });
    }
  }

  if (applied > 0) {
    await logAuditEvent({
      actorUserId: user.id, actorName: user.name, actorEmail: user.email,
      action: "DOC_EXTRACTION_APPLIED",
      entityType: "staffMember",
      entityId: "bulk",
      summary: `Aplicó ${applied} extracciones automáticas de fechas`,
    });
    revalidatePath("/trabajadores/control-documental");
    revalidatePath("/trabajadores");
  }

  return { applied, errors };
}
