"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, type AppRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { extractDocumentInfo, matchWorker, type ExtractedDoc } from "@/lib/document-extractor";
import { getTiposDocumento } from "@/lib/acreditacion-db";
import { agruparPorPersona, normalizarRut } from "@/lib/acreditacion";

const STAFF_MANAGER_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

export type ExtractedRow = ExtractedDoc & {
  /** Id del archivo que lo originó (un archivo puede dar varias filas). */
  clientFileId: string;
  /** Id único de esta fila: `${clientFileId}#${indice}`. */
  rowId: string;
  fileName: string;
  matches: Array<{ workerId: string; workerName: string; score: number; reason: string }>;
  error?: string;
};

/**
 * Analiza los archivos y devuelve una PROPUESTA. Un archivo puede producir
 * varias filas: los PDFs de acreditación suelen traer contrato, cédula y
 * exámenes concatenados.
 *
 * No escribe nada — eso pasa recién en applyExtractionsAction, después de
 * que el usuario revisa y corrige.
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
    getTiposDocumento(),
  ]);

  const results: ExtractedRow[] = [];

  for (const file of files) {
    try {
      const encontrados = await extractDocumentInfo({
        fileBase64: file.base64,
        mimeType: file.mimeType,
        fileName: file.fileName,
        tipos,
      });

      if (encontrados.length === 0) {
        results.push({
          clientFileId: file.clientFileId,
          rowId: `${file.clientFileId}#0`,
          fileName: file.fileName,
          detectedCodigo: "unknown",
          detectedTipoId: null,
          detectedDocTypeLabel: "Sin documentos reconocidos",
          expiryDate: null, issueDate: null,
          workerName: null, workerRut: null,
          paginaInicio: null,
          confidence: "low",
          reasoning: "La IA no reconoció ningún documento en el archivo.",
          matches: [],
        });
        continue;
      }

      encontrados.forEach((doc, i) => {
        const matches = matchWorker(
          { name: doc.workerName, rut: doc.workerRut },
          workers,
        ).map(m => {
          const w = workers.find(x => x.id === m.workerId)!;
          return { workerId: m.workerId, workerName: w.fullName, score: m.score, reason: m.reason };
        });

        results.push({
          clientFileId: file.clientFileId,
          rowId: `${file.clientFileId}#${i}`,
          fileName: file.fileName,
          ...doc,
          matches,
        });
      });
    } catch (e) {
      results.push({
        clientFileId: file.clientFileId,
        rowId: `${file.clientFileId}#err`,
        fileName: file.fileName,
        detectedCodigo: "unknown",
        detectedTipoId: null,
        detectedDocTypeLabel: "Error",
        expiryDate: null, issueDate: null,
        workerName: null, workerRut: null,
        paginaInicio: null,
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
export type FilaAplicar = {
  /** Id de un trabajador existente, o null si hay que crearlo. */
  workerId: string | null;
  /** Datos para crear el trabajador cuando workerId es null. */
  nuevoTrabajador?: { nombre: string; rut?: string | null } | null;
  tipoDocumentoId: string;
  expiryDate: string;          // YYYY-MM-DD
  issueDate?: string | null;   // YYYY-MM-DD
  confidence?: "high" | "medium" | "low";
  /** Archivo del que salió, para poder verlo después. */
  archivo?: { clientFileId: string; fileName: string; mimeType: string; base64: string } | null;
};

export async function applyExtractionsAction(
  rows: FilaAplicar[],
): Promise<{
  applied: number;
  creados: Array<{ id: string; nombre: string }>;
  errors: Array<{ workerId: string; error: string }>;
}> {
  const user = await requireRole(STAFF_MANAGER_ROLES);

  const tipos = await db.tipoDocumento.findMany({
    where: { activo: true },
    select: { id: true, codigo: true, legacyField: true },
  });
  const tipoPorId = new Map(tipos.map(t => [t.id, t]));

  const errors: Array<{ workerId: string; error: string }> = [];
  const creados: Array<{ id: string; nombre: string }> = [];
  let applied = 0;

  // ── Guardar los archivos una sola vez ────────────────────────────────
  // Un PDF con 12 documentos adentro produce 12 filas, pero el binario se
  // guarda una vez y todas apuntan a él.
  const archivoIdPorClientFileId = new Map<string, string>();
  for (const row of rows) {
    const a = row.archivo;
    if (!a || archivoIdPorClientFileId.has(a.clientFileId)) continue;
    try {
      const creado = await db.archivoAcreditacion.create({
        data: {
          contenido: Buffer.from(a.base64, "base64"),
          originalFilename: a.fileName,
          mimeType: a.mimeType,
          fileSize: Math.round((a.base64.length * 3) / 4),
          subidoPorNombre: user.name,
        },
        select: { id: true },
      });
      archivoIdPorClientFileId.set(a.clientFileId, creado.id);
    } catch {
      // Si falla el archivo igual guardamos las fechas: perder el binario
      // es malo, perder el vencimiento es peor.
    }
  }

  // ── Resolver a qué persona va cada fila ──────────────────────────────
  // Los documentos de una misma persona traen el nombre en distinto orden
  // ("Cortez Estay Rodrigo" vs "Rodrigo Cortez Estay") y a veces sin RUT.
  // Agrupamos antes de crear para no terminar con varias fichas de la
  // misma persona.
  const indicesACrear = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !r.workerId && r.nuevoTrabajador?.nombre?.trim());

  const grupos = agruparPorPersona(
    indicesACrear.map(({ r }) => ({
      nombre: r.nuevoTrabajador!.nombre.trim(),
      rut: r.nuevoTrabajador!.rut?.trim() || null,
    })),
  );

  // índice de fila original → staffMemberId
  const workerIdPorIndice = new Map<number, string>();

  for (const grupo of grupos) {
    try {
      // ¿Ya existe alguien con ese RUT o nombre? Reusar antes que duplicar.
      let existenteId: string | null = null;
      const rutNorm = normalizarRut(grupo.rut);
      if (rutNorm) {
        const candidatos = await db.staffMember.findMany({
          where: { nationalId: { not: null } },
          select: { id: true, nationalId: true },
        });
        existenteId = candidatos.find(c => normalizarRut(c.nationalId) === rutNorm)?.id ?? null;
      }

      const staffMemberId = existenteId ?? (await (async () => {
        const creado = await db.staffMember.create({
          data: {
            fullName: grupo.nombre,
            nationalId: grupo.rut,
            createdById: user.id,
            shiftStartDate: new Date(),
            isActive: true,
            notes: "Creado automáticamente al cargar documentos con IA",
          },
          select: { id: true, fullName: true },
        });
        creados.push({ id: creado.id, nombre: creado.fullName });
        return creado.id;
      })());

      for (const idxEnGrupo of grupo.indices) {
        const filaOriginal = indicesACrear[idxEnGrupo];
        if (filaOriginal) workerIdPorIndice.set(filaOriginal.i, staffMemberId);
      }
    } catch (e) {
      errors.push({ workerId: grupo.nombre, error: `No se pudo crear el trabajador: ${(e as Error).message}` });
    }
  }

  // ── Aplicar cada documento ───────────────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const workerId = row.workerId ?? workerIdPorIndice.get(i) ?? null;
    if (!workerId) {
      errors.push({ workerId: "—", error: "Fila sin trabajador asignado" });
      continue;
    }

    try {
      const tipo = tipoPorId.get(row.tipoDocumentoId);
      if (!tipo) {
        errors.push({ workerId, error: "Tipo de documento inválido" });
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.expiryDate)) {
        errors.push({ workerId, error: `Fecha inválida: ${row.expiryDate}` });
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
          staffMemberId: workerId,
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
          archivoId: row.archivo ? archivoIdPorClientFileId.get(row.archivo.clientFileId) ?? null : null,
        },
      });

      // Espejo a la columna plana para que la ficha muestre lo mismo
      if (tipo.legacyField) {
        await db.staffMember.update({
          where: { id: workerId },
          data: { [tipo.legacyField]: fechaVencimiento },
        });
      }

      applied++;
    } catch (e) {
      errors.push({ workerId, error: (e as Error).message });
    }
  }

  if (applied > 0 || creados.length > 0) {
    await logAuditEvent({
      actorUserId: user.id, actorName: user.name, actorEmail: user.email,
      action: "DOC_EXTRACTION_APPLIED",
      entityType: "documento",
      entityId: "bulk",
      summary: `Confirmó ${applied} documento(s) extraídos con IA` +
        (creados.length > 0 ? ` · creó ${creados.length} trabajador(es)` : ""),
    });
    revalidatePath("/trabajadores/control-documental");
    revalidatePath("/trabajadores");
    // La ficha de cada trabajador tocado también tiene que refrescarse
    for (const id of new Set(rows.map(r => r.workerId).filter(Boolean) as string[])) {
      revalidatePath(`/trabajadores/${id}`);
    }
    for (const c of creados) revalidatePath(`/trabajadores/${c.id}`);
  }

  return { applied, creados, errors };
}
