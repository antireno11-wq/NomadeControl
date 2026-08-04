"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, type AppRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { extractDocumentInfo, matchWorker, type ExtractedDoc } from "@/lib/document-extractor";

const STAFF_MANAGER_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

export type ExtractedRow = ExtractedDoc & {
  clientFileId: string;
  fileName: string;
  matches: Array<{ workerId: string; workerName: string; score: number; reason: string }>;
  error?: string;
};

/**
 * Analiza los archivos con OpenAI Vision y devuelve una PROPUESTA.
 * No escribe nada en la base — eso pasa recién en applyExtractionsAction,
 * después de que el usuario revisa y corrige.
 */
export async function extractDocumentsAction(
  files: Array<{ clientFileId: string; fileName: string; mimeType: string; base64: string }>,
): Promise<ExtractedRow[]> {
  await requireRole(STAFF_MANAGER_ROLES);

  const [workers, tipos] = await Promise.all([
    db.staffMember.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, nationalId: true },
    }),
    db.tipoDocumento.findMany({
      where: { activo: true },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { orden: "asc" },
    }),
  ]);

  const results: ExtractedRow[] = [];

  for (const file of files) {
    try {
      const extracted = await extractDocumentInfo({
        imageBase64: file.base64,
        mimeType: file.mimeType,
        fileName: file.fileName,
        tipos,
      });

      const matches = matchWorker(
        { name: extracted.workerName, rut: extracted.workerRut },
        workers,
      ).map(m => {
        const w = workers.find(x => x.id === m.workerId)!;
        return { workerId: m.workerId, workerName: w.fullName, score: m.score, reason: m.reason };
      });

      results.push({ clientFileId: file.clientFileId, fileName: file.fileName, ...extracted, matches });
    } catch (e) {
      results.push({
        clientFileId: file.clientFileId,
        fileName: file.fileName,
        detectedCodigo: "unknown",
        detectedTipoId: null,
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
 * Confirma las extracciones revisadas por el usuario: crea una fila nueva
 * en `Documento` por cada una (append-only) y espeja la fecha a la columna
 * plana de la ficha cuando el tipo tiene equivalente legacy.
 */
export async function applyExtractionsAction(
  rows: Array<{
    workerId: string;
    tipoDocumentoId: string;
    expiryDate: string;          // YYYY-MM-DD
    issueDate?: string | null;   // YYYY-MM-DD
    confidence?: "high" | "medium" | "low";
  }>,
): Promise<{ applied: number; errors: Array<{ workerId: string; error: string }> }> {
  const user = await requireRole(STAFF_MANAGER_ROLES);

  const tipos = await db.tipoDocumento.findMany({
    where: { activo: true },
    select: { id: true, codigo: true, legacyField: true },
  });
  const tipoPorId = new Map(tipos.map(t => [t.id, t]));

  const errors: Array<{ workerId: string; error: string }> = [];
  let applied = 0;

  for (const row of rows) {
    try {
      const tipo = tipoPorId.get(row.tipoDocumentoId);
      if (!tipo) {
        errors.push({ workerId: row.workerId, error: "Tipo de documento inválido" });
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.expiryDate)) {
        errors.push({ workerId: row.workerId, error: `Fecha inválida: ${row.expiryDate}` });
        continue;
      }

      const toUtcNoon = (s: string) => {
        const [y, m, d] = s.split("-").map(Number);
        return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      };

      const fechaVencimiento = toUtcNoon(row.expiryDate);
      const fechaEmision =
        row.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(row.issueDate) ? toUtcNoon(row.issueDate) : null;

      await db.documentoAcreditacion.create({
        data: {
          staffMemberId: row.workerId,
          tipoDocumentoId: row.tipoDocumentoId,
          fechaEmision,
          fechaVencimiento,
          vencimientoCalculado: false,
          origen: "extraido",
          confianzaExtraccion:
            row.confidence === "high" ? "alta" : row.confidence === "medium" ? "media" : "baja",
          confirmadoPorId: user.id,
          confirmadoPorNombre: user.name,
          confirmadoAt: new Date(),
          nota: "Extraído con IA y confirmado manualmente",
        },
      });

      // Espejo a la columna plana para que la ficha muestre lo mismo
      if (tipo.legacyField) {
        await db.staffMember.update({
          where: { id: row.workerId },
          data: { [tipo.legacyField]: fechaVencimiento },
        });
      }

      applied++;
    } catch (e) {
      errors.push({ workerId: row.workerId, error: (e as Error).message });
    }
  }

  if (applied > 0) {
    await logAuditEvent({
      actorUserId: user.id, actorName: user.name, actorEmail: user.email,
      action: "DOC_EXTRACTION_APPLIED",
      entityType: "documento",
      entityId: "bulk",
      summary: `Confirmó ${applied} documento(s) extraídos con IA`,
    });
    revalidatePath("/trabajadores/control-documental");
    revalidatePath("/trabajadores");
  }

  return { applied, errors };
}
