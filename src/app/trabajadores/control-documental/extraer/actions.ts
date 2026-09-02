"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, type AppRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { extractDocumentInfo, extraerFirmantes, extraerMrz, matchWorker, type ExtractedDoc } from "@/lib/document-extractor";
import { getTiposDocumento } from "@/lib/acreditacion-db";
import { agruparPorPersona, seleccionarVigentes, normalizarRut, adivinarTipoDesdeNombre, nombreMasProbable, mismoDocumentoProbable, mismoNombre, rutValido, claveNombre } from "@/lib/acreditacion";

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
  /** Ya existe un documento vigente de este tipo para el trabajador que se
   *  propone. Cargar no es lo mismo que reemplazar: uno llena un hueco y el
   *  otro deja obsoleto un papel que hoy sirve. */
  reemplazaA?: { vence: string | null; sinVencimiento: boolean } | null;
  /** El titular se heredó del resto del lote porque la hoja no lo traía. */
  titularHeredado?: boolean;
  /** Cantidad de firmantes cuando el documento es colectivo. */
  firmantes?: number | null;
  /** Documento colectivo donde NO figura la persona dueña del resto del lote. */
  ajenoAlLote?: boolean;
  /** RUT distinto del que trae la cédula de identidad de esta misma carga. */
  rutDeCedula?: string | null;
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

  const [workers, tipos, vigentes] = await Promise.all([
    db.staffMember.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, nationalId: true },
    }),
    getTiposDocumento(),
    // Lo que ya está cargado, para poder decir si esta fila llena un hueco o
    // reemplaza un papel que hoy sirve. Son cosas distintas y hasta ahora se
    // veían iguales.
    db.documentoAcreditacion.findMany({
      where: { anulado: false },
      select: {
        id: true, staffMemberId: true, tipoDocumentoId: true, fechaVencimiento: true,
        sinVencimiento: true, fechaEmision: true, anulado: true, createdAt: true,
      },
    }),
  ]);

  // Cuál es el vigente lo decide seleccionarVigentes, que es la única
  // autoridad sobre eso en todo el sistema. Ordenar por fechaVencimiento
  // descendente acá era distinto y además equivocado: en Postgres los NULL
  // van primeros en DESC, así que un documento sin fecha se presentaba como
  // el actual por encima de uno con vencimiento real.
  const vigentePorPar = new Map<string, { vence: string | null; sinVencimiento: boolean }>();
  for (const [clave, v] of seleccionarVigentes(vigentes)) {
    vigentePorPar.set(clave, {
      vence: v.fechaVencimiento ? v.fechaVencimiento.toISOString().slice(0, 10) : null,
      sinVencimiento: v.sinVencimiento,
    });
  }

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
          workerName: null, workerRut: null, titulares: null, sinVencimiento: false,
        empleadorNombre: null, empleadorRut: null, cargoContrato: null,
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
      // Si la primera pasada dijo que es colectivo, se relee la tabla con una
      // pasada dedicada. Se queda con la lista más larga: enumerar de menos es
      // el error que hemos visto, nunca de más.
      for (const doc of encontrados) {
        if (!doc.titulares || doc.titulares.length <= 1) continue;
        try {
          const completos = await extraerFirmantes({
            fileBase64: file.base64,
            mimeType: file.mimeType,
            fileName: file.fileName,
          });
          if (completos.length > doc.titulares.length) doc.titulares = completos;
        } catch {
          /* si falla, quedan los de la primera pasada */
        }
      }

      // La cédula manda sobre la identidad, y la banda del reverso manda sobre
      // la lectura libre del anverso. Es la única parte del documento con
      // formato fijo y dígito verificador: se puede comprobar en código, y por
      // eso pisa lo que dijo el modelo. Nos pasó leer bien el RUT, inventar el
      // nombre y equivocar las dos fechas, todo con confianza «Alta».
      for (const doc of encontrados) {
        if (doc.detectedCodigo !== "cedula_identidad") continue;
        try {
          const mrz = await extraerMrz({
            fileBase64: file.base64,
            mimeType: file.mimeType,
            fileName: file.fileName,
          });
          if (!mrz) continue;

          const cambioNombre = doc.workerName && !mismoNombre(doc.workerName, mrz.nombre);
          doc.workerName = mrz.nombre;
          doc.workerRut = mrz.rut;
          if (mrz.fechaVencimiento) {
            doc.expiryDate = mrz.fechaVencimiento;
            // Faltaba esto: la banda daba el vencimiento pero la fila seguía
            // marcada «no vence», así que el dato bueno no llegaba a verse.
            doc.sinVencimiento = false;
          }
          // La fecha de nacimiento NO es la de emisión: se descarta en vez de
          // dejarla ocupando el campo equivocado, que es lo que pasaba antes.
          if (doc.issueDate && doc.issueDate === mrz.fechaNacimiento) doc.issueDate = null;

          doc.reasoning = `${doc.reasoning} · Identidad tomada de la banda del reverso de la cédula, con RUT validado.`.trim();
          if (cambioNombre) {
            doc.confidence = "medium";
            doc.reasoning = `${doc.reasoning} REVISAR: el anverso se había leído como otro nombre.`;
          }
        } catch {
          /* si falla el segundo pase, queda la lectura del anverso */
        }
      }

      const expandidos: ExtractedDoc[] = encontrados.flatMap(doc =>
        doc.titulares && doc.titulares.length > 1
          ? doc.titulares.map(t => ({ ...doc, workerName: t.nombre, workerRut: t.rut }))
          : [doc],
      );

      expandidos.forEach((doc, i) => {
        // El nombre del archivo no es solo un plan B para cuando el modelo no
        // clasifica: también manda cuando lo contradice.
        //
        // La tabla de pistas solo dispara con palabras que nombran un tipo de
        // documento —"RIOHS", "finiquito", "cédula"—, nunca con un nombre
        // genérico. Cuando una de esas aparece, quien archivó el papel lo
        // tenía en la mano y lo nombró a propósito; el modelo, en cambio,
        // está distinguiendo entre documentos que se parecen. El RIOHS se
        // guardaba como IRL teniendo "RIOHS" escrito en el nombre.
        //
        // Igual queda marcado: si el archivo estaba mal nombrado, el aviso lo
        // delata en vez de esconderlo.
        const porNombre = adivinarTipoDesdeNombre(file.fileName, tipos);
        if (porNombre && !doc.detectedTipoId) {
          doc.detectedCodigo = porNombre.codigo;
          doc.detectedTipoId = porNombre.id;
          doc.detectedDocTypeLabel = porNombre.nombre;
          doc.reasoning = `${doc.reasoning} · Tipo deducido del nombre del archivo.`.trim();
        } else if (porNombre && porNombre.id !== doc.detectedTipoId) {
          const leido = doc.detectedDocTypeLabel ?? doc.detectedCodigo ?? "otro tipo";
          doc.detectedCodigo = porNombre.codigo;
          doc.detectedTipoId = porNombre.id;
          doc.detectedDocTypeLabel = porNombre.nombre;
          doc.confidence = "medium";
          // Las marcas que dependen del tipo se caen con el tipo. «No vence»
          // salía de haberlo leído como ficha de ingreso, que sí es una
          // constancia; al pasar a cédula deja de tener sentido y arrastraba
          // el error hasta la ficha.
          doc.sinVencimiento = false;
          doc.reasoning = `${doc.reasoning} · REVISAR: el nombre del archivo dice «${porNombre.nombre}» y el contenido se leyó como «${leido}». Se usó el del nombre.`.trim();
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
          reemplazaA: matches[0] && doc.detectedTipoId
            ? vigentePorPar.get(`${matches[0].workerId}|${doc.detectedTipoId}`) ?? null
            : null,
          firmantes: doc.titulares && doc.titulares.length > 1 ? doc.titulares.length : null,
          ajenoAlLote: false,
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
        workerName: null, workerRut: null, titulares: null, sinVencimiento: false,
        empleadorNombre: null, empleadorRut: null, cargoContrato: null,
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

  // 0. Titular dentro del mismo archivo.
  //    Un PDF de varias páginas nombra al trabajador en la primera y no lo
  //    repite en las demás. Esas páginas llegaban sin titular, caían en el
  //    grupo "sin persona" y no se juntaban con el resto del mismo archivo:
  //    el registro IRL aparecía dos veces, una asignada y otra sin asignar.
  //    Un archivo es de una sola persona, salvo que sea colectivo.
  const porArchivo = new Map<string, number[]>();
  results.forEach((r, i) => {
    const lista = porArchivo.get(r.clientFileId);
    if (lista) lista.push(i); else porArchivo.set(r.clientFileId, [i]);
  });
  for (const indices of porArchivo.values()) {
    if (indices.some(i => results[i].firmantes)) continue;  // colectivo: cada fila es de otro
    const referencia = indices.map(i => results[i]).find(r => r.workerName);
    if (!referencia) continue;
    for (const i of indices) {
      const fila = results[i];
      if (fila.workerName) {
        fila.workerRut = fila.workerRut ?? referencia.workerRut;
        continue;
      }
      fila.workerName = referencia.workerName;
      fila.workerRut = fila.workerRut ?? referencia.workerRut;
      fila.titularHeredado = true;
      fila.reasoning = `${fila.reasoning} · Titular tomado de las otras páginas del mismo archivo.`.trim();
    }
  }

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

  // 1.4 Una cédula de identidad chilena siempre trae vencimiento impreso.
  //     Nunca dice que no vence, así que marcarla así solo puede ser un error
  //     de lectura — pasó con un escaneo muy tenue. El efecto es el peor
  //     posible: la persona queda acreditada para siempre con un carnet que
  //     caduca. Sin fecha queda pendiente, que se ve; «no vence» no se ve.
  for (const r of results) {
    if (r.detectedCodigo !== "cedula_identidad" || !r.sinVencimiento) continue;
    r.sinVencimiento = false;
    r.confidence = "low";
    r.reasoning = `${r.reasoning} · Se descartó «no vence»: la cédula siempre trae fecha de vencimiento. Complétala a mano.`.trim();
  }

  // 1.5 Un documento no vence el mismo día que se emite.
  //     Los diplomas e-learning traen "Inicio" y "Término" del curso y al pie,
  //     en letra chica, "Vigencia: 2 años a partir de la fecha de término".
  //     El modelo tomaba la fecha grande como vencimiento y el curso quedaba
  //     vencido el día que se aprobó. Que emisión y vencimiento coincidan es
  //     comprobable sin leer el documento: entonces esa fecha es de emisión, y
  //     el vencimiento se recalcula abajo con la vigencia del tipo.
  for (const r of results) {
    if (!r.issueDate || !r.expiryDate || r.issueDate !== r.expiryDate) continue;
    r.expiryDate = null;
    r.reasoning = `${r.reasoning} · La fecha de vencimiento era la misma que la de emisión: se tomó como emisión.`.trim();
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

  // 2.5 Un documento que nace vencido casi siempre es un año mal leído.
  //     El certificado de antecedentes de Didier decía 14 de agosto de 2026 y
  //     se leyó 2022: el día y el mes correctos, el año no. Nadie sube a
  //     acreditar un papel que caducó hace cuatro años, así que la explicación
  //     probable es la lectura, no el documento.
  //     No se corrige sola —adivinar el año sería peor— pero se marca, que es
  //     lo que faltaba: llegaba como confianza alta y nadie la miraba.
  const hoy = new Date();
  for (const r of results) {
    if (!r.expiryDate || r.error) continue;
    const vence = new Date(`${r.expiryDate}T12:00:00`);
    if (Number.isNaN(vence.getTime()) || vence >= hoy) continue;
    r.confidence = "low";
    r.reasoning = `${r.reasoning} · REVISAR: llega vencido el ${r.expiryDate}. Puede ser un año mal leído — compara con el documento.`.trim();
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

  const cubos = new Map<string, number[]>();
  results.forEach((r, i) => {
    if (!r.detectedTipoId) return;
    // Las filas de un documento colectivo son una por firmante, a propósito.
    // Comparten archivo y tipo, así que el detector de duplicados las veía
    // como el mismo documento cargado dos veces.
    if (r.firmantes) return;
    const clave = `${indicePersona.get(i) ?? "sin-persona"}|${r.detectedTipoId}`;
    const lista = cubos.get(clave);
    if (lista) lista.push(i); else cubos.set(clave, [i]);
  });

  for (const [clave, indices] of cubos) {
    if (indices.length < 2) continue;

    // Compartir tipo NO alcanza para ser el mismo documento. El catálogo
    // nunca cubre todo lo que existe, así que el modelo mete un curso de
    // TMERT en "primeros auxilios" y una hoja de vida del conductor en
    // "licencia de conducir". Dentro de cada tipo se subagrupa por parecido
    // del nombre del archivo, que es lo que sí distingue las dos caras de
    // una cédula de dos cursos distintos.
    const subgrupos: number[][] = [];
    for (const i of indices) {
      const nombre = results[i].workerName;
      const destino = subgrupos.find(sub =>
        sub.some(j => mismoDocumentoProbable(results[j].fileName, results[i].fileName, nombre)),
      );
      if (destino) destino.push(i);
      else subgrupos.push([i]);
    }

    subgrupos.forEach((sub, k) => {
      if (sub.length < 2) return;
      for (const i of sub) results[i].grupoId = `${clave}#${k}`;
    });
  }

  // 4. Colectivo que no incluye a la persona de la carpeta.
  //    Una declaración jurada archivada en la carpeta de Walter pero firmada
  //    por otros dos es un error de archivo, no de lectura. La app no puede
  //    saber cuál es la verdad, pero sí avisar de la contradicción antes de
  //    crear dos fichas que nadie pidió.
  const noColectivas = results.filter(r => !r.firmantes && r.workerName);
  const dominante = noColectivas.length > 0
    ? nombreMasProbable(noColectivas.map(r => r.workerName!))
    : null;

  // 3.4 Un RUT con dígito verificador incorrecto no es un RUT.
  //     Se descarta antes de agrupar: dejarlo pasar hacía que cada lectura
  //     fallida del mismo documento inventara una persona nueva, porque la
  //     agrupación nunca fusiona dos RUT distintos. Sin RUT, esas filas se
  //     agrupan por nombre, que es lo correcto cuando el número no se lee.
  for (const r of results) {
    if (!r.workerRut || rutValido(r.workerRut)) continue;
    r.reasoning = `${r.reasoning} · El RUT leído (${r.workerRut}) no es válido: el dígito verificador no corresponde. Se descartó.`.trim();
    r.workerRut = null;
    r.confidence = "low";
  }

  // 3.45 Un mismo nombre no puede tener dos RUT: gana el que más se repite.
  //
  //      La cédula resuelve el conflicto cuando viene en la carga, pero muchas
  //      veces no viene. Ahí un solo documento con el RUT del profesional que
  //      lo firma —la enfermera de la mutualidad, siempre el mismo número—
  //      bastaba para partir a la persona en dos fichas, porque la agrupación
  //      nunca junta dos RUT distintos.
  //
  //      Dos personas con el nombre completo idéntico en la misma carpeta no
  //      existen en la práctica; un RUT mal leído, todo el tiempo.
  const porNombre = new Map<string, number[]>();
  results.forEach((r, i) => {
    if (!r.workerName) return;
    const k = claveNombre(r.workerName);
    if (!k) return;
    const lista = porNombre.get(k);
    if (lista) lista.push(i); else porNombre.set(k, [i]);
  });

  for (const indices of porNombre.values()) {
    const conteo = new Map<string, { rut: string; veces: number }>();
    for (const i of indices) {
      const norm = normalizarRut(results[i].workerRut);
      if (!norm) continue;
      const previo = conteo.get(norm);
      if (previo) previo.veces++;
      else conteo.set(norm, { rut: results[i].workerRut!, veces: 1 });
    }
    if (conteo.size < 2) continue;

    const ganador = [...conteo.values()].sort((a, b) => b.veces - a.veces)[0];
    for (const i of indices) {
      const norm = normalizarRut(results[i].workerRut);
      if (!norm || norm === normalizarRut(ganador.rut)) continue;
      results[i].reasoning =
        `${results[i].reasoning} · El RUT leído (${results[i].workerRut}) aparece solo en este documento; el resto de la carga usa ${ganador.rut}, así que se corrigió. Suele ser el RUT del profesional que firma.`.trim();
      results[i].workerRut = ganador.rut;
      results[i].confidence = "medium";
    }
  }

  // 3.5 El RUT de la cédula manda.
  //     La cédula es el documento que acredita la identidad; si otro papel de
  //     la misma carga trae un RUT distinto, o está mal leído o el archivo es
  //     de otra persona. Las dos cosas hay que mirarlas antes de crear una
  //     ficha nueva, que es lo que venía pasando.
  const cedula = results.find(r =>
    r.detectedCodigo === "cedula_identidad" && normalizarRut(r.workerRut),
  );
  if (cedula) {
    const rutCedula = normalizarRut(cedula.workerRut);
    for (const r of results) {
      const suyo = normalizarRut(r.workerRut);
      if (!suyo || suyo === rutCedula) continue;

      // Si el documento es de la MISMA persona que la cédula, el RUT distinto
      // es de otro que aparece adentro: en un examen de mutualidad, el del
      // profesional que lo firma. La cédula es el documento que acredita la
      // identidad, así que su RUT manda y se corrige acá. Sin esto, la persona
      // quedaba partida en dos fichas por un número que ni siquiera es suyo.
      if (r.workerName && cedula.workerName && mismoNombre(r.workerName, cedula.workerName)) {
        r.reasoning = `${r.reasoning} · El RUT leído (${r.workerRut}) es de otra persona nombrada en el documento; se usó el de la cédula.`.trim();
        r.workerRut = cedula.workerRut;
        continue;
      }

      r.rutDeCedula = cedula.workerRut;
      r.confidence = "low";
      r.reasoning = `${r.reasoning} · El RUT no calza con el de la cédula de esta carga (${cedula.workerRut}).`.trim();
    }
  }

  const descartar = new Set<number>();
  if (dominante) {
    for (const [, indices] of porArchivo) {
      const colectivas = indices.filter(i => results[i].firmantes);
      if (colectivas.length === 0) continue;

      const delDueño = colectivas.filter(i => {
        const r = results[i];
        return Boolean(r.workerName && mismoNombre(r.workerName, dominante));
      });

      if (delDueño.length > 0) {
        // La carga es de una persona: de un documento firmado por varias solo
        // interesa SU firma. Traer a los demás firmantes convertía una carpeta
        // en cinco fichas nuevas.
        for (const i of colectivas) if (!delDueño.includes(i)) descartar.add(i);
      } else {
        // No firmó. Se descartan los demás firmantes: estás guardando a una
        // persona y no tienen por qué aparecerte otras. Queda UNA fila, sin
        // titular y con el aviso, para no hacer desaparecer el archivo en
        // silencio: o lo asignas a mano o lo descartas con la ✕.
        const [primera, ...resto] = colectivas;
        results[primera].ajenoAlLote = true;
        results[primera].workerName = null;
        results[primera].workerRut = null;
        results[primera].reasoning =
          `${results[primera].reasoning} · Lo firman ${colectivas.length} personas y ninguna es ${dominante}.`.trim();
        for (const i of resto) descartar.add(i);
      }
    }
  }

  return results.filter((_, i) => !descartar.has(i));
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
  /** Razón social que contrata y cargo, en contratos y anexos. */
  empleadorNombre?: string | null;
  empleadorRut?: string | null;
  cargoContrato?: string | null;
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
  /**
   * Proyecto y cargo que se le asignan a los trabajadores creados en esta
   * carga. Sin ellos la persona nace "sin matriz" y no se le puede calcular
   * nada, que es lo que pasaba con todos los que creaba el extractor.
   */
  asignacion?: { proyectoId?: string | null; cargoId?: string | null },
): Promise<{
  applied: number;
  creados: Array<{ id: string; nombre: string }>;
  reactivados: string[];
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
  /** Estaban de baja y volvieron porque se les cargaron documentos. */
  const reactivados: string[] = [];
  let applied = 0;

  // ── Guardar los archivos una sola vez ────────────────────────────────
  // Un PDF con 12 documentos adentro produce 12 filas, pero el binario se
  // guarda una vez y todas apuntan a él.
  const archivoIdPorClientFileId = new Map<string, string>();
  /** Archivos que no se pudieron guardar, por nombre. Se anotan en el documento. */
  const archivosFallidos = new Map<string, string>();
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
    } catch (e) {
      // Si falla el archivo igual guardamos las fechas: perder el binario es
      // malo, perder el vencimiento es peor. Pero NO en silencio: así quedaban
      // documentos con la fecha correcta y sin papel, y en la ficha eso se ve
      // igual que un error del sistema. Queda anotado en el documento para que
      // se sepa qué hay que volver a subir.
      archivosFallidos.set(a.clientFileId, a.fileName);
      console.error("No se pudo guardar el archivo", a.fileName, e);
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
      // ¿Ya existe alguien con ese RUT? Reusar antes que duplicar. Se busca
      // también entre los inactivos: es la misma persona, y crear una ficha
      // nueva le partiría el historial en dos.
      let existenteId: string | null = null;
      let existenteInactivo = false;
      const rutNorm = normalizarRut(grupo.rut);
      if (rutNorm) {
        const candidatos = await db.staffMember.findMany({
          where: { nationalId: { not: null } },
          select: { id: true, nationalId: true, isActive: true },
        });
        const hallado = candidatos.find(c => normalizarRut(c.nationalId) === rutNorm) ?? null;
        existenteId = hallado?.id ?? null;
        existenteInactivo = Boolean(hallado && !hallado.isActive);
      }

      // Si estaba de baja, se reactiva. Antes los documentos se guardaban en
      // una ficha invisible: no aparecía en el tablero ni en la matriz, y la
      // pantalla decía que se habían agregado igual. Cargarle documentos a
      // alguien es la señal más clara de que volvió.
      if (existenteId && existenteInactivo) {
        await db.staffMember.update({
          where: { id: existenteId },
          data: { isActive: true, motivoBaja: null, fechaBaja: null },
        });
        reactivados.push(grupo.nombre);
      }

      const staffMemberId = existenteId ?? (await (async () => {
        const creado = await db.staffMember.create({
          data: {
            fullName: grupo.nombre,
            nationalId: grupo.rut,
            createdById: user.id,
            shiftStartDate: new Date(),
            isActive: true,
            proyectoId: asignacion?.proyectoId || null,
            cargoId: asignacion?.cargoId || null,
            notes: "Creado automáticamente al cargar documentos con IA",
          },
          select: { id: true, fullName: true },
        });
        creados.push({ id: creado.id, nombre: creado.fullName });

        // La acreditación también se registra en la tabla nueva. Sin esto, los
        // trabajadores creados después del arranque quedaban fuera del modelo
        // de dos faenas, porque la migración solo corre una vez por proceso.
        if (asignacion?.proyectoId) {
          await db.trabajadorProyecto.create({
            data: { staffMemberId: creado.id, proyectoId: asignacion.proyectoId },
          }).catch(() => {});
        }
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
      const archivoPerdido = row.archivo && !archivoId
        ? archivosFallidos.get(row.archivo.clientFileId) ?? row.archivo.fileName
        : null;

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
          empleadorNombre: row.empleadorNombre ?? null,
          empleadorRut: row.empleadorRut ?? null,
          cargoContrato: row.cargoContrato ?? null,
          origen: "extraido",
          confianzaExtraccion:
            row.confidence === "high" ? "alta" : row.confidence === "medium" ? "media" : "baja",
          confirmadoPorId: user.id,
          confirmadoPorNombre: user.name,
          confirmadoAt: new Date(),
          nota: [
            !tieneFecha && !tipo.noVence
              ? "Extraído con IA. Guardado sin fecha de vencimiento: el documento no la trae y el tipo no tiene vigencia definida."
              : "Extraído con IA y confirmado manualmente",
            archivoPerdido
              ? `EL ARCHIVO NO SE PUDO GUARDAR («${archivoPerdido}»). La fecha quedó registrada, pero hay que volver a subir el documento.`
              : null,
          ].filter(Boolean).join(" · "),
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
          data: {
            [tipo.legacyField]: fechaVencimiento,
            // Un contrato con fecha deja de ser indefinido.
            ...(tipo.codigo === "contrato_trabajo" ? { contractIsIndefinite: false } : {}),
          },
        });
      }

      // Un contrato o anexo indefinido no tiene fecha, así que el espejo de
      // arriba no corría y el trabajador seguía figurando a plazo fijo con la
      // fecha vieja. De ahí dependen la etiqueta de la ficha y los requisitos
      // condicionados al contrato indefinido —las pólizas—, que no se le
      // pedían a nadie.
      if ((tipo.codigo === "contrato_trabajo" || tipo.codigo === "anexo_contrato") && !tieneFecha) {
        await db.staffMember.update({
          where: { id: workerId },
          data: { contractIsIndefinite: true, contractEndDate: null },
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

  return { applied, creados, reactivados, errors };
}
