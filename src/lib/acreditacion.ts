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
  | "laboral"
  | "seguros";

export const CATEGORIA_LABEL: Record<CategoriaDocumento, string> = {
  identidad:         "Identidad",
  previsional:       "Previsional",
  salud_ocupacional: "Salud ocupacional",
  formacion:         "Formación",
  laboral:           "Laboral",
  seguros:           "Seguros",
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
  /** Documento de constancia: no caduca, se guarda sin fecha. */
  noVence?: boolean;
  /** Al cargarlo se guarda como foto del trabajador. */
  esFoto?: boolean;
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
  { codigo: "odi",                    nombre: "ODI / IRL / Inducción",                  categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Inducción",   legacyField: "inductionDueDate",        orden: 80 },
  { codigo: "acreditacion",           nombre: "Acreditación",                     categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: true,  etiquetaCorta: "Acredit.",    legacyField: "accreditationDueDate",    orden: 90 },

  // ── Identidad ────────────────────────────────────────────────────────
  { codigo: "certificado_antecedentes", nombre: "Certificado de antecedentes",    categoria: "identidad",         vigenciaDias: 60,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Antecedentes", legacyField: null, orden: 110 },
  { codigo: "certificado_residencia",   nombre: "Certificado de residencia",      categoria: "identidad",         vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Residencia",   legacyField: null, orden: 120 },
  { codigo: "registro_discapacidad",    nombre: "Certificado Registro Nacional de la Discapacidad", categoria: "identidad", vigenciaDias: null, requiereArchivo: true, mostrarEnMatriz: false, etiquetaCorta: "R. discapacidad", legacyField: null, noVence: true, orden: 125 },

  // ── Previsional ──────────────────────────────────────────────────────
  { codigo: "afiliacion_afp",           nombre: "Certificado de afiliación AFP",  categoria: "previsional",       vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "AFP",          legacyField: null, orden: 130 },
  { codigo: "certificado_cotizaciones", nombre: "Certificado de cotizaciones",    categoria: "previsional",       vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Cotizaciones", legacyField: null, orden: 140 },
  { codigo: "afiliacion_salud",         nombre: "Afiliación salud (Fonasa/Isapre)", categoria: "previsional",     vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Salud",        legacyField: null, orden: 150 },
  { codigo: "afiliacion_mutualidad",    nombre: "Afiliación mutualidad",          categoria: "previsional",       vigenciaDias: 30,   requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Mutualidad",   legacyField: null, orden: 160 },
  { codigo: "ley_trabajo_pesado",       nombre: "Certificado Ley de Trabajo Pesado", categoria: "previsional",    vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Trab. pesado", legacyField: null, noVence: true, orden: 165 },

  // ── Salud ocupacional ────────────────────────────────────────────────
  { codigo: "altura_fisica",            nombre: "Examen de altura física",        categoria: "salud_ocupacional", vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Altura fís.",  legacyField: null, orden: 170 },
  { codigo: "psicosensotecnico",        nombre: "Psicosensotécnico",              categoria: "salud_ocupacional", vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Psicosens.",   legacyField: null, orden: 180 },
  { codigo: "examen_alcohol_drogas",    nombre: "Examen de alcohol y drogas",     categoria: "salud_ocupacional", vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Alcohol/drogas", legacyField: null, orden: 185 },

  // ── Formación ────────────────────────────────────────────────────────
  // Inducciones: el Excel las tenía todas mezcladas bajo "ODI / IRL / Inducción".
  // Son cuatro documentos distintos, con emisor y vigencia propios: la ODI la
  // firma el trabajador, la inducción interna la dicta NOMADE, la del mandante
  // la dicta el cliente y el IRL existe en versión empresa y versión cliente.
  { codigo: "induccion_interna",        nombre: "Inducción interna de contrato",  categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Ind. interna", legacyField: null, orden: 191 },
  { codigo: "induccion_mandante",       nombre: "Inducción persona nueva (mandante)", categoria: "formacion",     vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Ind. mandante", legacyField: null, orden: 192 },
  { codigo: "riesgos_operacionales",    nombre: "Curso A1 — Riesgos operacionales", categoria: "formacion",       vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Riesgos op.",  legacyField: null, orden: 193 },
  { codigo: "irl_empresa",              nombre: "IRL empresa",                    categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "IRL empresa",  legacyField: null, noVence: true, orden: 194 },
  { codigo: "irl_cliente",              nombre: "IRL cliente / mandante",         categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "IRL cliente",  legacyField: null, noVence: true, orden: 195 },

  { codigo: "curso_4x4",                nombre: "Curso 4x4 teórico-práctico",     categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "4x4",          legacyField: null, orden: 189 },
  { codigo: "conduccion_defensiva",     nombre: "Conducción a la defensiva",      categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Cond. def.",   legacyField: null, orden: 190 },
  { codigo: "certificacion_competencias", nombre: "Certificación de competencias", categoria: "formacion",        vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Competencias", legacyField: null, orden: 200 },
  { codigo: "titulo_estudios",          nombre: "Título o certificado de estudios", categoria: "formacion",       vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Título",       legacyField: null, noVence: true, orden: 210 },
  // El Excel confirmó que 12 (16 hrs) y 12.1 (básico) NO son el mismo curso:
  // 10 trabajadores tienen uno aprobado y el otro pendiente.
  { codigo: "primeros_auxilios_basico", nombre: "Primeros auxilios (básico)",     categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "1eros aux. bás.", legacyField: null, orden: 211 },
  { codigo: "curso_primeros_auxilios",  nombre: "Curso de primeros auxilios (16 hrs)", categoria: "formacion",    vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "1eros aux.",   legacyField: null, orden: 212 },
  { codigo: "curso_extintores",         nombre: "Curso de uso de extintores",     categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Extintores",   legacyField: null, orden: 213 },
  { codigo: "curso_epp",                nombre: "Curso de uso y mantención de EPP", categoria: "formacion",       vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Curso EPP",    legacyField: null, orden: 214 },
  { codigo: "capacitacion_ruv",         nombre: "Capacitación RUV",               categoria: "formacion",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "RUV",          legacyField: null, orden: 215 },
  { codigo: "capacitacion_mmc",         nombre: "Capacitación manejo manual de cargas", categoria: "formacion",   vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "MMC",          legacyField: null, orden: 216 },
  { codigo: "capacitacion_sustancias",  nombre: "Capacitación sustancias peligrosas", categoria: "formacion",     vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Sust. pelig.", legacyField: null, orden: 217 },
  { codigo: "entrenamientos_especificos", nombre: "Cursos de entrenamientos específicos", categoria: "formacion",  vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Entren. esp.", legacyField: null, orden: 218 },

  // ── Laboral ──────────────────────────────────────────────────────────
  { codigo: "anexo_contrato",           nombre: "Anexo de contrato",              categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Anexo",        legacyField: null, orden: 220 },
  { codigo: "ficha_ingreso",            nombre: "Ficha de ingreso",               categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "F. ingreso",   legacyField: null, noVence: true, orden: 230 },
  { codigo: "cv",                       nombre: "Currículum actualizado",         categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "CV",           legacyField: null, noVence: true, orden: 232 },
  { codigo: "finiquito",                nombre: "Finiquito del último trabajo",   categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Finiquito",    legacyField: null, noVence: true, orden: 240 },
  // El mandante pide aparte el finiquito de un empleo anterior en su propia
  // faena. Es distinto del último finiquito y el Excel los mantenía separados.
  { codigo: "finiquito_mandante",       nombre: "Finiquito de trabajo anterior en el mandante", categoria: "laboral", vigenciaDias: null, requiereArchivo: true, mostrarEnMatriz: false, etiquetaCorta: "Finiq. mandante", legacyField: null, noVence: true, orden: 241 },

  // ── Constancias: no caducan, solo tienen que existir ──────────────────
  { codigo: "entrega_epp",              nombre: "Acta de entrega de EPP",         categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Entrega EPP",  legacyField: null, noVence: true, orden: 250 },
  { codigo: "recepcion_riohs",          nombre: "Recepción del RIOHS",            categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "RIOHS",        legacyField: null, noVence: true, orden: 251 },
  { codigo: "declaracion_jurada",       nombre: "Declaración jurada",             categoria: "laboral",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Decl. jurada", legacyField: null, noVence: true, orden: 252 },

  // ── Seguros ──────────────────────────────────────────────────────────
  // Solo los exige el mandante para contratos permanentes.
  { codigo: "poliza_muerte_accidental", nombre: "Póliza de muerte accidental e invalidez (≥ 2.500 UF)", categoria: "seguros", vigenciaDias: null, requiereArchivo: true, mostrarEnMatriz: false, etiquetaCorta: "Pól. accid.",  legacyField: null, orden: 260 },
  { codigo: "poliza_salud_dental",      nombre: "Póliza de salud y dental",       categoria: "seguros",           vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Pól. salud",   legacyField: null, orden: 261 },
  { codigo: "poliza_muerte_natural",    nombre: "Póliza de muerte natural (≥ 500 UF)", categoria: "seguros",      vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Pól. natural", legacyField: null, orden: 262 },

  // ── Foto ─────────────────────────────────────────────────────────────
  { codigo: "foto",                     nombre: "Foto del trabajador",            categoria: "identidad",         vigenciaDias: null, requiereArchivo: true,  mostrarEnMatriz: false, etiquetaCorta: "Foto",         legacyField: null, noVence: true, esFoto: true, orden: 5 },
];

/**
 * Correlativo de la matriz de acreditación del mandante → código interno.
 *
 * El código del mandante se usa como nombre de subcarpeta por trabajador, así
 * que hay que poder ir y volver. Varios correlativos apuntan al mismo tipo
 * porque la planilla llegó a pedir el mismo documento dos veces:
 *   01 / 36 → cédula        04 / 37 → foto        23 / 39 → estudios
 */
export const CODIGO_MATRIZ_A_TIPO: Record<string, string> = {
  "01": "cedula_identidad",
  "02": "contrato_trabajo",
  "03": "anexo_contrato",
  "04": "foto",
  "05": "examen_ocupacional",
  "06": "altura_geografica",
  "07": "examen_alcohol_drogas",
  "08": "psicosensotecnico",
  "09": "induccion_mandante",
  "10": "riesgos_operacionales",
  "11": "induccion_interna",
  "12": "curso_primeros_auxilios",
  "12.1": "primeros_auxilios_basico",
  "13": "curso_extintores",
  "14": "curso_epp",
  "15": "entrenamientos_especificos",
  "16": "manipulacion_alimentos",
  "17": "certificacion_competencias",
  "18": "licencia_conducir",
  "19": "entrega_epp",
  "20": "recepcion_riohs",
  "21": "odi",
  "22": "declaracion_jurada",
  "23": "titulo_estudios",
  "24": "irl_empresa",
  "25": "irl_cliente",
  "26": "poliza_muerte_accidental",
  "27": "poliza_salud_dental",
  "28": "poliza_muerte_natural",
  "29": "finiquito_mandante",
  "30": "ley_trabajo_pesado",
  "31": "registro_discapacidad",
  "32": "certificado_antecedentes",
  "33": "certificado_residencia",
  "34": "afiliacion_afp",
  "35": "afiliacion_salud",
  "36": "cedula_identidad",
  "37": "foto",
  "38": "cv",
  "39": "titulo_estudios",
  "40": "certificado_cotizaciones",
  "41": "finiquito",
  "C1": "curso_4x4",
  "C2": "conduccion_defensiva",
};

/**
 * Renombres intencionales del catálogo. Se aplican solo si el tipo todavía
 * tiene el nombre viejo, para no pisar ediciones hechas desde Administración.
 */
/**
 * Vigencias que se corrigen en instalaciones existentes. Igual que los
 * renombres: solo se aplican si el tipo conserva el valor viejo, para no
 * pisar un ajuste hecho a mano desde Administración.
 */
/**
 * Tipos que pasan a "no vence" en instalaciones existentes.
 *
 * Son documentos que simplemente no traen fecha: la ficha de ingreso no tiene
 * fecha de elaboración, un certificado de estudios y un finiquito no caducan.
 * Exigirles un vencimiento impedía guardarlos.
 */
export const AJUSTES_NO_VENCE: string[] = [
  "ficha_ingreso",
  "titulo_estudios",
  "finiquito",
  "finiquito_mandante",
];

export const AJUSTES_VIGENCIA: { codigo: string; desde: number | null; vigenciaDias: number }[] = [
  // El certificado de antecedentes no trae vencimiento impreso; el mandante
  // lo acepta 60 días desde la emisión.
  { codigo: "certificado_antecedentes", desde: 30, vigenciaDias: 60 },
];

export const RENOMBRES_CATALOGO: { codigo: string; desde: string; nombre: string; etiquetaCorta: string }[] = [
  // Dejó de ser el cajón de sastre de inducciones: ahora cada una es su tipo.
  { codigo: "odi", desde: "ODI / IRL / Inducción", nombre: "ODI — Derecho a saber (el IRL la reemplaza)", etiquetaCorta: "ODI" },
  { codigo: "certificacion_competencias", desde: "Certificación de competencias", nombre: "Certificado de especialidad", etiquetaCorta: "Especialidad" },
  { codigo: "declaracion_jurada", desde: "Declaración jurada", nombre: "Declaración jurada por competencias", etiquetaCorta: "Decl. jurada" },
  { codigo: "titulo_estudios", desde: "Título o certificado de estudios", nombre: "Certificado de estudios / nivel educacional", etiquetaCorta: "Estudios" },
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
  /**
   * El tipo está marcado como que no vence en el catálogo. Manda por sobre
   * la fecha guardada en el documento: si alguien corrige en Administración
   * que un certificado no caduca, los que ya estaban cargados con una fecha
   * calculada tienen que dejar de aparecer vencidos. La alternativa —que el
   * cambio solo valga para los documentos futuros— obliga a volver a subir
   * todo para que el catálogo diga la verdad.
   */
  tipoNoVence = false,
): { estado: EstadoDocumento; dias: number | null } {
  if (!doc) return { estado: "sin_fecha", dias: null };
  if (doc.sinVencimiento || tipoNoVence) return { estado: "sin_vencimiento", dias: null };

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

  if (comunes.length < 2) return false;
  // Caso limpio: el nombre corto está entero dentro del largo.
  if (comunes.length === corto.length) return true;

  // Con tres o más partes coincidentes se tolera una que no calce: es lo que
  // pasa cuando el OCR se come una letra o un documento escribe "Morale" en
  // vez de "Morales". Exigir coincidencia total partía a una persona en
  // varias fichas. Con solo dos partes en común NO se fusiona: "Juan Pérez
  // González" y "Juan Pérez Soto" son dos personas distintas.
  return comunes.length >= 3 && corto.length - comunes.length <= 1;
}

export type PersonaDetectada = {
  /** Clave canónica del grupo. */
  clave: string;
  nombre: string;
  rut: string | null;
  /** Índices de las filas que pertenecen a esta persona. */
  indices: number[];
  /** Todas las variantes de nombre leídas, para el voto por mayoría. */
  variantes: string[];
};

/**
 * Pasa un nombre a formato título respetando las partículas.
 * "JESUS SOTO OYARZUN" → "Jesus Soto Oyarzun"
 * (los acentos los pone el modelo; esto es solo la red de seguridad)
 */
export function formatearNombre(nombre: string): string {
  const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "y", "da", "das", "dos"]);
  return nombre
    .trim()
    .toLocaleLowerCase("es")
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra, i) =>
      i > 0 && MINUSCULAS.has(palabra)
        ? palabra
        : palabra.charAt(0).toLocaleUpperCase("es") + palabra.slice(1),
    )
    .join(" ");
}

/**
 * Elige el nombre más confiable entre varias lecturas de la misma persona.
 *
 * Un OCR puede equivocarse en un documento suelto ("Oyarzún" → "Ovarizun").
 * Si el resto de los documentos coincide, la mayoría corrige el error.
 * A igualdad de votos gana el más largo, que suele ser el completo.
 */
export function nombreMasProbable(variantes: string[]): string {
  const limpias = variantes.map(v => v.trim()).filter(Boolean);
  if (limpias.length === 0) return "";
  if (limpias.length === 1) return limpias[0];

  const votos = new Map<string, { nombre: string; n: number }>();
  for (const v of limpias) {
    const clave = v.toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "");
    const actual = votos.get(clave);
    if (actual) actual.n++;
    else votos.set(clave, { nombre: v, n: 1 });
  }

  return Array.from(votos.values())
    .sort((a, b) => b.n - a.n || b.nombre.length - a.nombre.length)[0].nombre;
}

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
      if (!existente.rut && fila.rut) existente.rut = fila.rut;
      if (fila.nombre) existente.variantes.push(fila.nombre);
    } else {
      grupos.push({
        clave: normalizarRut(fila.rut) || claveNombre(fila.nombre ?? ""),
        nombre: fila.nombre ?? "",
        rut: fila.rut,
        indices: [fila.i],
        variantes: fila.nombre ? [fila.nombre] : [],
      });
    }
  }

  // El nombre del grupo lo decide la mayoría, no el primero que apareció:
  // así una lectura errónea aislada no se impone sobre las correctas.
  for (const g of grupos) {
    g.indices.sort((a, b) => a - b);
    if (g.variantes.length > 0) g.nombre = formatearNombre(nombreMasProbable(g.variantes));
  }

  return grupos;
}


// ─── Pistas del nombre de archivo ──────────────────────────────────────

/**
 * Adivina el tipo de documento desde el nombre del archivo.
 *
 * Las carpetas de acreditación se nombran por su contenido
 * ("Curso Manipulación SUSPEL.pdf", "04 Examen Altura Geografica.pdf").
 * Cuando el PDF viene en blanco o ilegible, el nombre es la única
 * información que queda.
 */
export function adivinarTipoDesdeNombre(
  fileName: string,
  tipos: Array<{ id: string; codigo: string; nombre: string }>,
): { id: string; codigo: string; nombre: string } | null {
  const limpio = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Palabras clave → código del catálogo, de lo más específico a lo general.
  // Cuando hay varios códigos, se usa el primero que exista y esté activo:
  // sirve para los documentos que una empresa reemplazó por otro.
  const PISTAS: Array<[RegExp, string | string[]]> = [
    [/suspel|sustancias?\s*peligrosas?/,        "capacitacion_sustancias"],
    [/manejo\s*manual|\bmmc\b/,                "capacitacion_mmc"],
    [/\bruv\b/,                                 "capacitacion_ruv"],
    [/primeros\s*auxilios.*basico|basico.*primeros\s*auxilios/, "primeros_auxilios_basico"],
    [/primeros\s*auxilios/,                     "curso_primeros_auxilios"],
    [/extintor/,                                "curso_extintores"],
    [/\b4\s*x\s*4\b|cuatro\s*por\s*cuatro/,     "curso_4x4"],
    [/riesgos?\s*operacional/,                  "riesgos_operacionales"],
    [/entrenamiento.*especifico/,               "entrenamientos_especificos"],

    // Inducciones e IRL: van antes de /contrato/, porque el nombre real de
    // varios de estos archivos es "Inducción Interna Contrato".
    [/irl.*(cliente|mandante|anglo)/,           "irl_cliente"],
    [/\birl\b/,                                 "irl_empresa"],
    // La ODI (derecho a saber del DS 40) quedó reemplazada por el IRL en
    // varias empresas. Si el tipo ODI está desactivado, el archivo cae en el
    // IRL en vez de quedar sin clasificar.
    [/\bodi\b|derecho\s*a\s*saber/,             ["odi", "irl_empresa"]],
    [/induccion.*(cliente|mandante|anglo|persona\s*nueva)/, "induccion_mandante"],
    [/induccion/,                               "induccion_interna"],
    [/uso.*\bepp\b|curso.*\bepp\b/,             "curso_epp"],
    [/entrega.*\bepp\b|acta.*\bepp\b/,         "entrega_epp"],
    [/riohs|reglamento\s*interno/,               "recepcion_riohs"],
    [/declaracion\s*jurada/,                    "declaracion_jurada"],
    [/alcohol|drogas/,                          "examen_alcohol_drogas"],
    [/altura\s*geografica/,                     "altura_geografica"],
    [/altura\s*fisica/,                         "altura_fisica"],
    [/psicosensotecnico|psicosensor/,           "psicosensotecnico"],
    [/ocupacional|preocupacional/,              "examen_ocupacional"],
    [/manipulacion.*alimento/,                  "manipulacion_alimentos"],
    [/vacuna/,                                  "vacunas"],
    [/licencia.*conducir|conducir/,             "licencia_conducir"],
    [/cedula|carnet.*identidad/,                "cedula_identidad"],
    [/anexo.*contrato/,                         "anexo_contrato"],
    [/contrato/,                                "contrato_trabajo"],
    [/finiquito.*(anglo|mandante|cliente)/,     "finiquito_mandante"],
    [/finiquito/,                               "finiquito"],
    [/antecedente/,                             "certificado_antecedentes"],
    [/residencia/,                              "certificado_residencia"],
    [/\bafp\b|afiliacion.*afp/,                 "afiliacion_afp"],
    [/cotizacion/,                              "certificado_cotizaciones"],
    [/fonasa|isapre|afiliacion.*salud/,         "afiliacion_salud"],
    [/mutualidad/,                              "afiliacion_mutualidad"],
    [/conduccion.*defensiva|manejo.*defensiv/,  "conduccion_defensiva"],
    [/acreditacion|credencial/,                 "acreditacion"],
    [/ficha.*ingreso/,                          "ficha_ingreso"],
    [/titulo|certificado.*estudio|nivel\s*educacional/, "titulo_estudios"],
    [/especialidad|certificado.*electric/,      "certificacion_competencias"],
    [/poliza.*(accidental|invalidez)/,          "poliza_muerte_accidental"],
    [/poliza.*(dental|salud)/,                  "poliza_salud_dental"],
    [/poliza.*natural/,                         "poliza_muerte_natural"],
    [/trabajo\s*pesado/,                        "ley_trabajo_pesado"],
    [/discapacidad/,                            "registro_discapacidad"],
    [/curriculum|hoja\s*de\s*vida|\bcv\b/,      "cv"],
    [/\bfoto\b/,                                "foto"],
  ];

  for (const [patron, codigos] of PISTAS) {
    if (!patron.test(limpio)) continue;
    for (const codigo of Array.isArray(codigos) ? codigos : [codigos]) {
      const tipo = tipos.find(t => t.codigo === codigo);
      if (tipo) return tipo;
    }
  }
  return null;
}
