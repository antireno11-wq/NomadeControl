/**
 * Matriz de requisitos: qué documento le exige un proyecto a un cargo.
 *
 * Reemplaza la columna "Aplica a" de la planilla, que era texto libre
 * ("Todos", "Conductores", "Segun cargo") y que nadie aplicaba: en el Excel
 * había que escribir N/A a mano, celda por celda, 37 veces por documento.
 * El resultado eran ~100 pendientes fantasma — maestros de cocina a los que
 * se les exigía curso 4x4 — que hundían el avance del proyecto.
 *
 * Acá la regla vive en un solo lugar y el N/A deja de existir: si no hay
 * fila de requisito, el documento no aplica.
 */

/** obligatorio bloquea la habilitación; deseable solo informa. */
export type NivelRequisito = "obligatorio" | "deseable";

export const NIVEL_LABEL: Record<NivelRequisito, string> = {
  obligatorio: "Obligatorio",
  deseable:    "Deseable",
};

/**
 * Condición del trabajador que activa el requisito. NULL = siempre aplica.
 * Son las únicas dos reglas de la planilla que no dependen del cargo sino
 * de la persona.
 */
export type CondicionRequisito =
  | "contrato_indefinido"
  | "trabajo_previo_mandante"
  | "contrato_vencido";

export const CONDICION_LABEL: Record<CondicionRequisito, string> = {
  contrato_indefinido:     "Solo con contrato indefinido",
  trabajo_previo_mandante: "Solo si trabajó antes en el mandante",
  contrato_vencido:        "Solo si el contrato ya venció",
};

export const CONDICIONES: CondicionRequisito[] = [
  "contrato_indefinido",
  "trabajo_previo_mandante",
  "contrato_vencido",
];

// ─── Cargos ────────────────────────────────────────────────────────────

export type CargoSeed = { nombre: string; orden: number };

/** Los 10 grupos de dotación de la matriz de Agua Verde. */
export const CARGOS_SEED: CargoSeed[] = [
  { nombre: "Administrador de Contrato",    orden: 10 },
  { nombre: "Especialista HSEC",            orden: 20 },
  { nombre: "Supervisor de Campamento",     orden: 30 },
  { nombre: "Supervisor de Montaje",        orden: 40 },
  { nombre: "Maestro de Cocina",            orden: 50 },
  { nombre: "Ayudante de Cocina",           orden: 60 },
  { nombre: "Campamentero / Aux. de Aseo",  orden: 70 },
  { nombre: "Montajista",                   orden: 80 },
  { nombre: "Conductor Abastecedor B",      orden: 90 },
  { nombre: "Conductor A4",                 orden: 100 },
];

const CARGOS_CONDUCTORES = ["Conductor Abastecedor B", "Conductor A4"];
const CARGOS_COCINA      = ["Maestro de Cocina", "Ayudante de Cocina"];

// ─── Matriz por defecto ────────────────────────────────────────────────

export type ReglaSeed = {
  /** Código del tipo de documento. */
  tipo: string;
  /** Cargos a los que aplica. `null` = a todos. */
  cargos: string[] | null;
  nivel: NivelRequisito;
  condicion?: CondicionRequisito;
  /** Solo se siembra si la faena supera esta altura. */
  sobreMsnm?: number;
};

/**
 * Reglas que la planilla sí declaraba de forma inequívoca.
 *
 * Los seis documentos que la planilla marcaba como "Segun cargo" sin decir
 * cuál — primeros auxilios (16 hrs y básico), extintores, entrenamientos
 * específicos, certificado de especialidad y declaración jurada por
 * competencias — NO se siembran a propósito. Adivinarlos sería inventar una
 * exigencia contractual: se definen en Administración → Requisitos, que los
 * muestra destacados hasta que alguien decida.
 */
/** Programa de requisitos: una matriz completa lista para sembrar. */
export type ProgramaSeed = {
  mandante: string;
  proyecto: string;
  ambito: "mandante" | "interno";
  faena?: string;
  reglas: ReglaSeed[];
};

/**
 * Lo que Anglo American exige para dejar entrar a una persona a su faena.
 * Sale del documento "D&G Andes Hub_Chile" del mandante.
 *
 * NO incluye antecedentes, residencia, AFP, Fonasa, cotizaciones, CV ni
 * certificado de estudios: eso lo pide NOMADE para contratar, no Anglo para
 * acreditar, y mezclarlos hacía que a un trabajador se le bloqueara el
 * ingreso a faena por un papel que el mandante nunca le pidió.
 */
export const REGLAS_MANDANTE_ANGLO: ReglaSeed[] = [
  // Documentación personal
  { tipo: "cedula_identidad",          cargos: null, nivel: "obligatorio" },
  { tipo: "contrato_trabajo",          cargos: null, nivel: "obligatorio" },
  { tipo: "anexo_contrato",            cargos: null, nivel: "obligatorio", condicion: "contrato_vencido" },
  { tipo: "irl_empresa",               cargos: null, nivel: "obligatorio" },
  { tipo: "examen_ocupacional",        cargos: null, nivel: "obligatorio" },
  { tipo: "altura_geografica",         cargos: null, nivel: "obligatorio" },
  { tipo: "recepcion_riohs",           cargos: null, nivel: "obligatorio" },
  { tipo: "declaracion_jurada",        cargos: null, nivel: "obligatorio" },
  { tipo: "entrega_epp",               cargos: null, nivel: "obligatorio" },
  { tipo: "examen_alcohol_drogas",     cargos: null, nivel: "obligatorio" },

  // Entrenamientos generales
  { tipo: "curso_primeros_auxilios",   cargos: null, nivel: "obligatorio" },
  { tipo: "curso_extintores",          cargos: null, nivel: "obligatorio" },
  { tipo: "curso_epp",                 cargos: null, nivel: "obligatorio" },
  { tipo: "entrenamientos_especificos", cargos: null, nivel: "obligatorio" },

  // "Certificados de calificaciones para personal especialista": solo a
  // quienes ejercen una especialidad, así que no bloquea a los demás.
  { tipo: "certificacion_competencias", cargos: null, nivel: "deseable" },

  // Documentación de conductores
  { tipo: "licencia_conducir",         cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
  { tipo: "hoja_vida_conductor",       cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
  { tipo: "psicosensotecnico",         cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
  { tipo: "conduccion_defensiva",      cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
  { tipo: "curso_4x4",                 cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
];

/**
 * Lo que NOMADE exige para contratar. Sale de la planilla interna, y son
 * justamente los documentos que Anglo no pide.
 */
export const REGLAS_INTERNAS_NOMADE: ReglaSeed[] = [
  { tipo: "ficha_ingreso",             cargos: null, nivel: "obligatorio" },
  { tipo: "foto",                      cargos: null, nivel: "obligatorio" },
  { tipo: "certificado_antecedentes",  cargos: null, nivel: "obligatorio" },
  { tipo: "certificado_residencia",    cargos: null, nivel: "obligatorio" },
  { tipo: "afiliacion_afp",            cargos: null, nivel: "obligatorio" },
  { tipo: "afiliacion_salud",          cargos: null, nivel: "obligatorio" },
  { tipo: "certificado_cotizaciones",  cargos: null, nivel: "obligatorio" },
  { tipo: "titulo_estudios",           cargos: null, nivel: "obligatorio" },
  { tipo: "cv",                        cargos: null, nivel: "obligatorio" },
  { tipo: "induccion_interna",         cargos: null, nivel: "obligatorio" },
  { tipo: "manipulacion_alimentos",    cargos: CARGOS_COCINA, nivel: "obligatorio" },

  // "Si aplica" en la planilla: se piden, pero no bloquean.
  { tipo: "finiquito",                 cargos: null, nivel: "deseable" },
  { tipo: "finiquito_mandante",        cargos: null, nivel: "deseable", condicion: "trabajo_previo_mandante" },
  { tipo: "poliza_muerte_accidental",  cargos: null, nivel: "deseable", condicion: "contrato_indefinido" },
  { tipo: "poliza_salud_dental",       cargos: null, nivel: "deseable", condicion: "contrato_indefinido" },
  { tipo: "poliza_muerte_natural",     cargos: null, nivel: "deseable", condicion: "contrato_indefinido" },
  { tipo: "ley_trabajo_pesado",        cargos: null, nivel: "deseable" },
  { tipo: "registro_discapacidad",     cargos: null, nivel: "deseable" },
];

/** Se crean solos al arrancar, para no armarlos a mano en la interfaz. */
export const PROGRAMAS_SEED: ProgramaSeed[] = [
  { mandante: "Anglo American", proyecto: "Agua Verde", faena: "Los Bronces", ambito: "mandante", reglas: REGLAS_MANDANTE_ANGLO },
  { mandante: "Servicios Integrales Nómade Chile", proyecto: "Contratación", ambito: "interno", reglas: REGLAS_INTERNAS_NOMADE },
];

/** Compatibilidad: el sembrado por defecto de un proyecto de mandante. */
export const REGLAS_SEED: ReglaSeed[] = REGLAS_MANDANTE_ANGLO;


/**
 * Están en el catálogo del mandante pero SIN columna en su matriz: la propia
 * planilla los anota como «agregar si el cliente los exige». Sembrarlos como
 * obligatorios inflaba lo que le falta a cada trabajador con documentos que
 * hoy nadie le está pidiendo.
 */
/**
 * Condiciones que se corrigen en matrices ya sembradas.
 *
 * Solo se aplican donde la condición está vacía: nunca pisan una elección
 * hecha desde la grilla. Existen porque una regla nueva en REGLAS_SEED solo
 * alcanza a los proyectos que se creen después, y obligar a arreglar a mano
 * un proyecto ya cargado es trasladarle al usuario un cambio de la app.
 */
export const AJUSTES_CONDICION: { tipo: string; condicion: CondicionRequisito }[] = [
  { tipo: "anexo_contrato", condicion: "contrato_vencido" },
];

export const TIPOS_SOLO_SI_EL_CLIENTE_LOS_EXIGE = [
  "odi",
  "riesgos_operacionales",
];

/**
 * Los seis que quedaron sin regla. La grilla los destaca para que alguien
 * los defina en vez de que pasen desapercibidos.
 */
export const TIPOS_SIN_REGLA_DEFINIDA = [
  "curso_primeros_auxilios",
  "primeros_auxilios_basico",
  "curso_extintores",
  "entrenamientos_especificos",
  "certificacion_competencias",
  "declaracion_jurada",
];

// ─── Evaluación ────────────────────────────────────────────────────────

export type RequisitoAplicable = {
  tipoId: string;
  nivel: NivelRequisito;
  condicion: CondicionRequisito | null;
};

export type CondicionesTrabajador = {
  contratoIndefinido: boolean;
  trabajoPrevioMandante: boolean;
  contratoVencido: boolean;
};

/** ¿Este requisito le corre a este trabajador en concreto? */
export function requisitoAplica(
  req: { condicion: string | null },
  cond: CondicionesTrabajador,
): boolean {
  switch (req.condicion) {
    case "contrato_indefinido":     return cond.contratoIndefinido;
    case "trabajo_previo_mandante": return cond.trabajoPrevioMandante;
    case "contrato_vencido":        return cond.contratoVencido;
    default:                        return true;
  }
}
