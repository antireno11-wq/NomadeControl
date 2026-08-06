"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, type AppRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { extractDocumentInfo, matchWorker, type ExtractedDoc } from "@/lib/document-extractor";
import { getTiposDocumento } from "@/lib/acreditacion-db";
import { agruparPorPersona, normalizarRut, adivinarTipoDesdeNombre, nombreMasProbable } from "@/lib/acreditacion";

const STAFF_MANAGER_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

export type ExtractedRow = ExtractedDoc & {
  /** Id del archivo que lo originó (un archivo puede dar varias filas). */
  clientFileId: string;
  /** Id único de esta fila: `${clientFileId}#${indice}`. */
  rowId: string;
  fileName: string;
  matches: Array<{ workerId: string; workerName: string; score: number; reason: string }>;
  error?: string;
  /** Filas que apuntan al mismo (persona, tipo): las dos caras de la cédula,
   *  las hojas sueltas de una ficha de ingreso, o una carga repetida. */
  grupoId?: string | null;
  /** El vencimiento se dedujo de la vigencia del tipo, no venía impreso. */
  expiryCalculada?: boolean;
  /** El titular se heredó del resto del lote porque la hoja no lo traía. */
  titularHeredado?: boolean;
  /** Cantidad de firmantes cuando el documento es colectivo. */
  firmantes?: number | null;
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
        tipos: tipos.map(t => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, noVence: t.noVence })),
      });

      if (encontrados.length === 0) {
        // El archivo no se pudo leer: diploma en blanco, escaneo ilegible o
        // una foto sin texto. Nunca lo descartamos en silencio — se propone
        // lo que se pueda deducir del nombre y el humano completa el resto.
        const esImagen = file.mimeType.startsWith("image/");
        const porNombre = adivinarTipoDesdeNombre(file.fileName, tipos);
        const tipoFoto = esImagen && !porNombre ? tipos.find(t => t.esFoto) ?? null : null;
        const propuesto = porNombre ?? tipoFoto;

        results.push({
          clientFileId: file.clientFileId,
          rowId: `${file.clientFileId}#0`,
          fileName: file.fileName,
          detectedCodigo: propuesto?.codigo ?? "unknown",
          detectedTipoId: propuesto?.id ?? null,
          detectedDocTypeLabel: propuesto?.nombre ?? "Sin reconocer",
          expiryDate: null, issueDate: null,
          workerName: null, workerRut: null, titulares: null,
          paginaInicio: null,
          confidence: "low",
          reasoning: porNombre
            ? `No se pudo leer el contenido (¿plantilla en blanco o escaneo ilegible?). Tipo deducido del nombre del archivo.`
            : tipoFoto
              ? "Imagen sin texto de documento: se propone como foto del trabajador."
              : "No se pudo leer el archivo ni deducir el tipo del nombre. Elige el tipo a mano.",
          matches: [],
        });
        continue;
      }

      // Un documento colectivo —una declaración jurada firmada por toda la
      // cuadrilla— es UN papel que vale para varias personas. Se expande en
      // una fila por firmante; todas comparten el archivo, así que el binario
      // se guarda una sola vez y queda enlazado en cada ficha.
      const expandidos: ExtractedDoc[] = encontrados.flatMap(doc =>
        doc.titulares && doc.titulares.length > 1
          ? doc.titulares.map(t => ({ ...doc, workerName: t.nombre, workerRut: t.rut }))
          : [doc],
      );

      expandidos.forEach((doc, i) => {
        // Si el modelo no supo clasificarlo pero el nombre del archivo sí lo
        // delata, aprovechamos esa pista.
        if (!doc.detectedTipoId) {
          const porNombre = adivinarTipoDesdeNombre(file.fileName, tipos);
          if (porNombre) {
            doc.detectedCodigo = porNombre.codigo;
            doc.detectedTipoId = porNombre.id;
            doc.detectedDocTypeLabel = porNombre.nombre;
            doc.reasoning = `${doc.reasoning} · Tipo deducido del nombre del archivo.`.trim();
          }
        }

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
          firmantes: doc.titulares && doc.titulares.length > 1 ? doc.titulares.length : null,
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
        workerName: null, workerRut: null, titulares: null,
        paginaInicio: null,
        confidence: "low",
        reasoning: "",
        matches: [],
        error: (e as Error).message,
      });
    }
  }

  return normalizarPropuesta(results, tipos);
}

/**
 * Arregla, sobre la propuesta completa, tres cosas que no se pueden resolver
 * mirando un archivo a la vez.
 */
function normalizarPropuesta(
  results: ExtractedRow[],
  tipos: Array<{ id: string; codigo: string; nombre: string; vigenciaDias: number | null; noVence: boolean; esFoto: boolean }>,
): ExtractedRow[] {
  const tipoPorId = new Map(tipos.map(t => [t.id, t]));

  // 1. Titular heredado.
  //    Una foto carnet no tiene nombre, y la hoja 2 de la ficha de ingreso
  //    solo trae el contacto de emergencia. Si todo el lote converge en UNA
  //    sola persona, esas hojas son de ella. Con dos o más personas en el
  //    lote no se hereda nada: asignar mal es peor que dejar sin asignar.
  const personas = agruparPorPersona(
    results.map(r => ({ nombre: r.workerName, rut: r.workerRut })),
  );
  if (personas.length === 1) {
    const p = personas[0];
    const nombre = p.variantes.length > 0 ? nombreMasProbable(p.variantes) : p.nombre;
    for (const r of results) {
      if (r.workerName) continue;
      r.workerName = nombre || null;
      r.workerRut = r.workerRut ?? p.rut;
      r.titularHeredado = Boolean(nombre);
      if (nombre) {
        r.reasoning = `${r.reasoning} · Titular tomado del resto de los archivos del lote.`.trim();
      }
    }
  }

  // 2. Vencimiento deducido de la vigencia del tipo.
  //    El certificado de antecedentes no trae vencimiento impreso: vale 60
  //    días desde la emisión. Se muestra ya calculado en la propuesta, no
  //    recién al guardar, para que se pueda corregir antes.
  for (const r of results) {
    if (r.expiryDate || !r.issueDate || !r.detectedTipoId) continue;
    const tipo = tipoPorId.get(r.detectedTipoId);
    if (!tipo || tipo.noVence || tipo.esFoto || !tipo.vigenciaDias) continue;

    const emision = new Date(`${r.issueDate}T00:00:00`);
    if (Number.isNaN(emision.getTime())) continue;
    emision.setDate(emision.getDate() + tipo.vigenciaDias);
    r.expiryDate = emision.toISOString().slice(0, 10);
    r.expiryCalculada = true;
    r.reasoning = `${r.reasoning} · Vencimiento calculado: ${tipo.vigenciaDias} días desde la emisión.`.trim();
  }

  // 3. Agrupación por (persona, tipo).
  //    La cédula subida como dos fotos —o como un JPG y un PDF— son dos filas
  //    del mismo documento, no dos documentos. Se marcan con un grupo y la UI
  //    deja decidir: combinarlas en uno o dejarlas separadas.
  //
  //    La agrupación se recalcula DESPUÉS de heredar el titular. Al hacerlo
  //    antes, las hojas que llegaban sin nombre —el reverso de la cédula, la
  //    hoja 3 de la ficha de ingreso— quedaban en "sin-persona" y no se
  //    juntaban nunca con las hojas que sí lo traían.
  const indicePersona = new Map<number, string>();
  if (personas.length === 1) {
    // Un solo titular en todo el lote: todo es de esa persona, incluso lo que
    // sigue sin nombre después de la herencia.
    const clave = personas[0].clave || "p0";
    results.forEach((_, i) => indicePersona.set(i, clave));
  } else {
    const personasFinales = agruparPorPersona(
      results.map(r => ({ nombre: r.workerName, rut: r.workerRut })),
    );
    personasFinales.forEach((p, i) => p.indices.forEach(idx => indicePersona.set(idx, p.clave || `p${i}`)));
  }

  const conteo = new Map<string, number>();
  results.forEach((r, i) => {
    if (!r.detectedTipoId) return;
    const clave = `${indicePersona.get(i) ?? "sin-persona"}|${r.detectedTipoId}`;
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  });

  results.forEach((r, i) => {
    if (!r.detectedTipoId) return;
    const clave = `${indicePersona.get(i) ?? "sin-persona"}|${r.detectedTipoId}`;
    r.grupoId = (conteo.get(clave) ?? 0) > 1 ? clave : null;
  });

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
  /** Vacío cuando el tipo no vence (constancias, foto). */
  expiryDate?: string | null;  // YYYY-MM-DD
  issueDate?: string | null;   // YYYY-MM-DD
  confidence?: "high" | "medium" | "low";
  /** true si la fecha se infirió de emisión + vigencia, en vez de leerse. */
  vencimientoCalculado?: boolean;
  /** El usuario decidió guardarlo sin vencimiento porque el documento no lo
   *  trae y el tipo no define vigencia. Se registra la nota para que en la
   *  ficha se vea que la fecha quedó pendiente, no que no existe. */
  sinVencimiento?: boolean;
  /** Archivo del que salió, para poder verlo después. */
  archivo?: { clientFileId: string; fileName: string; mimeType: string; base64: string } | null;
  /** Caras u hojas adicionales del MISMO documento: el reverso de la cédula,
   *  las páginas sueltas de una ficha de ingreso. Se guardan todas y quedan
   *  colgando de un solo documento en vez de crear uno por hoja. */
  archivosExtra?: Array<{ clientFileId: string; fileName: string; mimeType: string; base64: string }>;
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
    select: { id: true, codigo: true, legacyField: true, noVence: true, esFoto: true, vigenciaDias: true },
  });
  const tipoPorId = new Map(tipos.map(t => [t.id, t]));

  const errors: Array<{ workerId: string; error: string }> = [];
  const creados: Array<{ id: string; nombre: string }> = [];
  let applied = 0;

  // ── Guardar los archivos una sola vez ────────────────────────────────
  // Un PDF con 12 documentos adentro produce 12 filas, pero el binario se
  // guarda una vez y todas apuntan a él.
  const archivoIdPorClientFileId = new Map<string, string>();
  const todosLosArchivos = rows.flatMap(r => [r.archivo, ...(r.archivosExtra ?? [])]);
  for (const a of todosLosArchivos) {
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
      const toUtcNoon = (s: string) => {
        const [y, m, d] = s.split("-").map(Number);
        return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      };

      const archivoId = row.archivo ? archivoIdPorClientFileId.get(row.archivo.clientFileId) ?? null : null;

      // Foto del trabajador. Va a la ficha para mostrarla en el perfil, pero
      // además se registra como documento: el mandante la exige y si no queda
      // en el catálogo la matriz la da por faltante para siempre, aunque esté
      // cargada y visible en la ficha.
      if (tipo.esFoto) {
        if (!archivoId) {
          errors.push({ workerId, error: "La foto no se pudo guardar (archivo faltante)" });
          continue;
        }
        await db.staffMember.update({
          where: { id: workerId },
          data: { fotoArchivoId: archivoId },
        });
        await db.documentoAcreditacion.create({
          data: {
            staffMemberId: workerId,
            tipoDocumentoId: row.tipoDocumentoId,
            fechaEmision: row.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(row.issueDate) ? toUtcNoon(row.issueDate) : null,
            fechaVencimiento: null,
            sinVencimiento: true,
            origen: "extraido",
            confianzaExtraccion:
              row.confidence === "high" ? "alta" : row.confidence === "medium" ? "media" : "baja",
            confirmadoPorId: user.id,
            confirmadoPorNombre: user.name,
            confirmadoAt: new Date(),
            nota: "Foto del trabajador",
            archivoId,
          },
        });
        applied++;
        continue;
      }

      const fechaEmision =
        row.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(row.issueDate) ? toUtcNoon(row.issueDate) : null;

      let fechaVencimiento =
        row.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(row.expiryDate) ? toUtcNoon(row.expiryDate) : null;
      let calculado = Boolean(row.vencimientoCalculado);

      // Si el documento no trae vencimiento impreso pero el tipo tiene una
      // vigencia por defecto, la derivamos de la emisión. Queda marcada como
      // calculada: ante un reclamo del mandante hay que poder distinguir una
      // fecha inferida de una que estaba escrita en el papel.
      if (!fechaVencimiento && fechaEmision && tipo.vigenciaDias && tipo.vigenciaDias > 0) {
        fechaVencimiento = new Date(fechaEmision.getTime() + tipo.vigenciaDias * 86_400_000);
        calculado = true;
      }

      const tieneFecha = Boolean(fechaVencimiento);

      // Los tipos de constancia se guardan sin vencimiento. Los demás lo
      // exigen, salvo que el usuario decida explícitamente lo contrario:
      // rechazar el documento lo deja como "no cargado" en la matriz y
      // encima pierde el archivo, que es peor que registrarlo incompleto.
      if (!tieneFecha && !tipo.noVence && !row.sinVencimiento) {
        errors.push({ workerId, error: "Falta la fecha de vencimiento" });
        continue;
      }

      const documentoCreado = await db.documentoAcreditacion.create({
        select: { id: true },
        data: {
          staffMemberId: workerId,
          tipoDocumentoId: row.tipoDocumentoId,
          fechaEmision,
          fechaVencimiento,
          sinVencimiento: !tieneFecha,
          vencimientoCalculado: calculado,
          origen: "extraido",
          confianzaExtraccion:
            row.confidence === "high" ? "alta" : row.confidence === "medium" ? "media" : "baja",
          confirmadoPorId: user.id,
          confirmadoPorNombre: user.name,
          confirmadoAt: new Date(),
          nota: !tieneFecha && !tipo.noVence
            ? "Extraído con IA. Guardado sin fecha de vencimiento: el documento no la trae y el tipo no tiene vigencia definida."
            : "Extraído con IA y confirmado manualmente",
          archivoId,
        },
      });

      // Caras u hojas adicionales del mismo documento.
      const extras = (row.archivosExtra ?? [])
        .map(a => archivoIdPorClientFileId.get(a.clientFileId))
        .filter((id): id is string => Boolean(id) && id !== archivoId);
      if (extras.length > 0) {
        await db.archivoDeDocumento.createMany({
          data: extras.map((id, orden) => ({
            documentoId: documentoCreado.id,
            archivoId: id,
            orden: orden + 1,
          })),
          skipDuplicates: true,
        });
      }

      // Espejo a la columna plana para que la ficha muestre lo mismo
      if (tipo.legacyField && fechaVencimiento) {
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
