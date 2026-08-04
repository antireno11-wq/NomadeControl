/**
 * Módulo Acreditación — catálogo de tipos y cálculo de estado.
 *
 * El estado NO se persiste: se deriva siempre de los documentos vigentes.
 * Un documento vigente es, por cada par (trabajador, tipo), el no anulado
 * con la fecha de vencimiento más lejana.
 */

export type CategoriaDocumento =
  | "identidad"
  | "previsional"
  | "salud_ocupacional"
  | "formacion"
  | "laboral";

export const CATEGORIA_LABEL: Record<CategoriaDocumento, string> = {
  identidad:         "Identidad",
  previsional:       "Previsional",
  salud_ocupacional: "Salud ocupacional",
  formacion:         "Formación",
  laboral:           "Laboral",
};

export type TipoDocumentoSeed = {
  codigo: string;
  nombre: string;
  categoria: CategoriaDocumento;
  vigenciaDias: number | null;
  requiereArchivo: boolean;
  mostrarEnMatriz: boolean;
  etiquetaCorta: string | null;
  /** Columna equivalente en StaffMember, para el backfill. */
  legacyField: string | null;
  orden: number;
};

/**
 * Catálogo inicial. Los primeros 9 corresponden a las columnas planas que
 * ya existían en StaffMember — se identifican por `legacyField` y son los
 * que se muestran como columnas en la matriz.
 *
 * El resto viene de la especificación de acreditación y queda disponible
 * para cargar por ficha, sin ensuciar la matriz.
 */
export const TIPOS_DOCUMENTO_SEED: TipoDocumentoSeed[] = [
  // ── Core: mapean a columnas existentes y salen en la matriz ──────────
  { codigo: "contrato_trabajo",       nombre: "Contrato de trabajo",              categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Contrato",    legacyField: "contractEndDate",         orden: 10 },
  { codigo: "cedula_identidad",       nombre: "Cédula de identidad",              categoria: "identidad",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "C. identidad", legacyField: "cedulaExpiryDate",        orden: 20 },
  { codigo: "licencia_conducir",      nombre: "Licencia de conducir",             categoria: "identidad",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Licencia",    legacyField: "driversLicenseDueDate",   orden: 30 },
  { codigo: "examen_ocupacional",     nombre: "Examen ocupacional (mutualidad)",  categoria: "salud_ocupacional", vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Ocupacional", legacyField: "occupationalExamDueDate", orden: 40 },
  { codigo: "altura_geografica",      nombre: "Examen de altura geográfica",      categoria: "salud_ocupacional", vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Altura",      legacyField: "altitudeExamDueDate",     orden: 50 },
  { codigo: "manipulacion_alimentos", nombre: "Manipulación de alimentos",        categoria: "salud_ocupacional", vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Aliment.",    legacyField: "foodHandlingExamDueDate", orden: 60 },
  { codigo: "vacunas",                nombre: "Vacunas",                          categoria: "salud_ocupacional", vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Vacunas",     legacyField: "vaccineDueDate",          orden: 70 },
  { codigo: "odi",                    nombre: "ODI / Inducción",                  categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Inducción",   legacyField: "inductionDueDate",        orden: 80 },
  { codigo: "acreditacion",           nombre: "Acreditación",                     categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Acredit.",    legacyField: "accreditationDueDate",    orden: 90 },

  // ── Identidad ────────────────────────────────────────────────────────
  { codigo: "certificado_antecedentes", nombre: "Certificado de antecedentes",    categoria: "identidad",         vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Antecedentes", legacyField: null, orden: 110 },
  { codigo: "certificado_residencia",   nombre: "Certificado de residencia",      categoria: "identidad",         vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Residencia",   legacyField: null, orden: 120 },

  // ── Previsional ──────────────────────────────────────────────────────
  { codigo: "afiliacion_afp",           nombre: "Certificado de afiliación AFP",  categoria: "previsional",       vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "AFP",          legacyField: null, orden: 130 },
  { codigo: "certificado_cotizaciones", nombre: "Certificado de cotizaciones",    categoria: "previsional",       vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Cotizaciones", legacyField: null, orden: 140 },
  { codigo: "afiliacion_salud",         nombre: "Afiliación salud (Fonasa/Isapre)", categoria: "previsional",     vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Salud",        legacyField: null, orden: 150 },
  { codigo: "afiliacion_mutualidad",    nombre: "Afiliación mutualidad",          categoria: "previsional",       vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Mutualidad",   legacyField: null, orden: 160 },

  // ── Salud ocupacional ────────────────────────────────────────────────
  { codigo: "altura_fisica",            nombre: "Examen de altura física",        categoria: "salud_ocupacional", vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Altura fís.",  legacyField: null, orden: 170 },
  { codigo: "psicosensotecnico",        nombre: "Psicosensotécnico",              categoria: "salud_ocupacional", vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Psicosens.",   legacyField: null, orden: 180 },

  // ── Formación ────────────────────────────────────────────────────────
  { codigo: "conduccion_defensiva",     nombre: "Conducción a la defensiva",      categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Cond. def.",   legacyField: null, orden: 190 },
  { codigo: "certificacion_competencias", nombre: "Certificación de competencias", categoria: "formacion",        vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Competencias", legacyField: null, orden: 200 },
  { codigo: "titulo_estudios",          nombre: "Título o certificado de estudios", categoria: "formacion",       vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Título",       legacyField: null, orden: 210 },

  // ── Laboral ──────────────────────────────────────────────────────────
  { codigo: "anexo_contrato",           nombre: "Anexo de contrato",              categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Anexo",        legacyField: null, orden: 220 },
  { codigo: "ficha_ingreso",            nombre: "Ficha de ingreso",               categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "F. ingreso",   legacyField: null, orden: 230 },
  { codigo: "finiquito",                nombre: "Finiquito",                      categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Finiquito",    legacyField: null, orden: 240 },
];

/** Mapa legacyField → codigo, para el backfill y la sincronización. */
export const LEGACY_FIELD_TO_CODIGO: Record<string, string> = Object.fromEntries(
  TIPOS_DOCUMENTO_SEED.filter(t => t.legacyField).map(t => [t.legacyField!, t.codigo]),
);

/**
 * Mapa del campo `tipo` (string libre) de DocumentoTrabajador al código
 * del catálogo nuevo. Los que no matchean caen en "otro" durante el backfill.
 */
export const DOCUMENTO_TRABAJADOR_TIPO_MAP: Record<string, string> = {
  licencia_conducir:     "licencia_conducir",
  carnet_identidad:      "cedula_identidad",
  contrato:              "contrato_trabajo",
  anexo_contrato:        "anexo_contrato",
  examen_preocupacional: "examen_ocupacional",
  examen_periodico:      "examen_ocupacional",
  odi_firmada:           "odi",
  induccion:             "odi",
  capacitacion:          "certificacion_competencias",
  credencial:            "acreditacion",
  altura_fisica:         "altura_fisica",
  altura_trabajos:       "altura_fisica",
  espacios_confinados:   "certificacion_competencias",
  antecedentes:          "certificado_antecedentes",
  finiquito:             "finiquito",
};

// ─── Estado ────────────────────────────────────────────────────────────

export type EstadoDocumento = "vigente" | "por_vencer" | "vencido" | "sin_fecha" | "sin_vencimiento";

export const ESTADO_STYLE: Record<EstadoDocumento, { bg: string; color: string; border: string; label: string }> = {
  vigente:         { bg: "#e8f7ef", color: "#146c3d", border: "#b6e8c8", label: "Vigente" },
  sin_vencimiento: { bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc", label: "Sin vencimiento" },
  por_vencer:      { bg: "#fff4dc", color: "#9a6300", border: "#f5d98e", label: "Por vencer" },
  vencido:         { bg: "#fce9e8", color: "#9e2f23", border: "#f5c0bb", label: "Vencido" },
  sin_fecha:       { bg: "#f1f5f9", color: "#64748b", border: "#cbd5e1", label: "Sin cargar" },
};

const DAY_MS = 86_400_000;

export function diasRestantes(fechaVencimiento: Date | null, hoy = new Date()): number | null {
  if (!fechaVencimiento) return null;
  const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const target = Date.UTC(
    fechaVencimiento.getUTCFullYear(),
    fechaVencimiento.getUTCMonth(),
    fechaVencimiento.getUTCDate(),
  );
  return Math.ceil((target - base) / DAY_MS);
}

/**
 * Umbral de "por vencer" en días. Parametrizable — en Fase B pasa a
 * leerse del requisito de la faena.
 */
export const UMBRAL_POR_VENCER_DIAS = 30;

export function calcularEstado(
  doc: { fechaVencimiento: Date | null; sinVencimiento: boolean } | null,
  hoy = new Date(),
  umbralDias = UMBRAL_POR_VENCER_DIAS,
): { estado: EstadoDocumento; dias: number | null } {
  if (!doc) return { estado: "sin_fecha", dias: null };
  if (doc.sinVencimiento) return { estado: "sin_vencimiento", dias: null };

  const dias = diasRestantes(doc.fechaVencimiento, hoy);
  if (dias == null) return { estado: "sin_fecha", dias: null };
  if (dias < 0) return { estado: "vencido", dias };
  if (dias <= umbralDias) return { estado: "por_vencer", dias };
  return { estado: "vigente", dias };
}

/** Un estado cuenta como cumplimiento OK. */
export function esEstadoOk(estado: EstadoDocumento): boolean {
  return estado === "vigente" || estado === "sin_vencimiento";
}

// ─── Selección del documento vigente ───────────────────────────────────

type DocumentoComparable = {
  id: string;
  staffMemberId: string;
  tipoDocumentoId: string;
  fechaVencimiento: Date | null;
  sinVencimiento: boolean;
  anulado: boolean;
  createdAt: Date;
};

/**
 * Equivalente en JS del `DISTINCT ON (trabajador, tipo) ... ORDER BY
 * fecha_vencimiento DESC NULLS LAST` de la spec.
 *
 * Gana el documento no anulado con vencimiento más lejano. `sinVencimiento`
 * gana siempre (no caduca). Un documento sin fecha pierde contra uno con
 * fecha. A igualdad, gana el cargado más recientemente.
 *
 * Se hace en memoria y no como vista de Postgres para no depender de SQL
 * crudo: con ~500 trabajadores × ~23 tipos el costo es despreciable.
 */
export function seleccionarVigentes<T extends DocumentoComparable>(documentos: T[]): Map<string, T> {
  const porClave = new Map<string, T>();

  for (const doc of documentos) {
    if (doc.anulado) continue;
    const clave = `${doc.staffMemberId}|${doc.tipoDocumentoId}`;
    const actual = porClave.get(clave);
    if (!actual || ganaDocumento(doc, actual)) {
      porClave.set(clave, doc);
    }
  }

  return porClave;
}

function rankVencimiento(doc: DocumentoComparable): number {
  if (doc.sinVencimiento) return Number.POSITIVE_INFINITY;
  if (!doc.fechaVencimiento) return Number.NEGATIVE_INFINITY;
  return doc.fechaVencimiento.getTime();
}

function ganaDocumento(candidato: DocumentoComparable, actual: DocumentoComparable): boolean {
  const rc = rankVencimiento(candidato);
  const ra = rankVencimiento(actual);
  if (rc !== ra) return rc > ra;
  return candidato.createdAt.getTime() > actual.createdAt.getTime();
}

// ─── Identidad de personas ─────────────────────────────────────────────

/** RUT sin puntos, guiones ni espacios, en mayúsculas. */
export function normalizarRut(rut?: string | null): string {
  return (rut ?? "").replace(/[.\-\s]/g, "").toUpperCase();
}

/**
 * Clave de nombre invariante al orden de las palabras.
 *
 * Los documentos chilenos alternan entre "Apellidos Nombres" y
 * "Nombres Apellidos". Ordenando los tokens alfabéticamente, ambas
 * formas producen la misma clave:
 *
 *   "Rodrigo Esteban Cortez Estay" → "cortez esteban estay rodrigo"
 *   "Cortez Estay Rodrigo Esteban" → "cortez esteban estay rodrigo"
 */
export function claveNombre(nombre: string): string {
  return tokensNombre(nombre).sort().join(" ");
}

export function tokensNombre(nombre: string): string[] {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * ¿Los dos nombres son de la misma persona?
 *
 * Además del orden, tolera que un documento traiga el nombre incompleto
 * ("Rodrigo Cortez" vs "Rodrigo Esteban Cortez Estay"): si todos los
 * tokens del más corto están en el más largo y comparten al menos dos,
 * los damos por la misma persona.
 */
export function mismoNombre(a: string, b: string): boolean {
  const ta = tokensNombre(a);
  const tb = tokensNombre(b);
  if (ta.length === 0 || tb.length === 0) return false;

  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const comunes = corto.filter(t => largo.includes(t));
  return comunes.length >= 2 && comunes.length === corto.length;
}

export type PersonaDetectada = {
  /** Clave canónica del grupo. */
  clave: string;
  nombre: string;
  rut: string | null;
  /** Índices de las filas que pertenecen a esta persona. */
  indices: number[];
};

/**
 * Agrupa filas extraídas por persona.
 *
 * Un PDF de acreditación trae el nombre escrito de formas distintas en
 * cada documento y a veces sin RUT. Sin esto, una sola persona termina
 * creando varias fichas.
 *
 * Estrategia:
 *  1. Agrupar por RUT cuando está presente (es la llave fuerte)
 *  2. Las filas sin RUT se pegan al grupo cuyo nombre coincide
 *  3. Lo que queda se agrupa entre sí por nombre
 */
export function agruparPorPersona(
  filas: Array<{ nombre: string | null; rut: string | null }>,
): PersonaDetectada[] {
  const grupos: PersonaDetectada[] = [];

  const buscarGrupo = (nombre: string | null, rut: string | null) => {
    const rutNorm = normalizarRut(rut);
    if (rutNorm) {
      const porRut = grupos.find(g => normalizarRut(g.rut) === rutNorm);
      if (porRut) return porRut;
    }
    if (nombre) {
      const porNombre = grupos.find(g => {
        // No mezclar grupos con RUTs distintos y conocidos
        if (rutNorm && g.rut && normalizarRut(g.rut) !== rutNorm) return false;
        return mismoNombre(g.nombre, nombre);
      });
      if (porNombre) return porNombre;
    }
    return null;
  };

  // Primero las filas con RUT: fijan los grupos canónicos
  const orden = filas
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => (normalizarRut(b.rut) ? 1 : 0) - (normalizarRut(a.rut) ? 1 : 0));

  for (const fila of orden) {
    if (!fila.nombre && !fila.rut) continue;

    const existente = buscarGrupo(fila.nombre, fila.rut);
    if (existente) {
      existente.indices.push(fila.i);
      // Completar datos faltantes del grupo
      if (!existente.rut && fila.rut) existente.rut = fila.rut;
      // Preferir el nombre más largo: suele ser el completo
      if (fila.nombre && fila.nombre.length > existente.nombre.length) {
        existente.nombre = fila.nombre;
      }
    } else {
      grupos.push({
        clave: normalizarRut(fila.rut) || claveNombre(fila.nombre ?? ""),
        nombre: fila.nombre ?? "",
        rut: fila.rut,
        indices: [fila.i],
      });
    }
  }

  for (const g of grupos) g.indices.sort((a, b) => a - b);
  return grupos;
}
