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
export type CondicionRequisito = "contrato_indefinido" | "trabajo_previo_mandante";

export const CONDICION_LABEL: Record<CondicionRequisito, string> = {
  contrato_indefinido:     "Solo con contrato indefinido",
  trabajo_previo_mandante: "Solo si trabajó antes en el mandante",
};

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
export const REGLAS_SEED: ReglaSeed[] = [
  // Todos
  { tipo: "cedula_identidad",          cargos: null, nivel: "obligatorio" },
  { tipo: "contrato_trabajo",          cargos: null, nivel: "obligatorio" },
  { tipo: "anexo_contrato",            cargos: null, nivel: "obligatorio" },
  { tipo: "foto",                      cargos: null, nivel: "obligatorio" },
  { tipo: "examen_ocupacional",        cargos: null, nivel: "obligatorio" },
  { tipo: "examen_alcohol_drogas",     cargos: null, nivel: "obligatorio" },
  { tipo: "induccion_mandante",        cargos: null, nivel: "obligatorio" },
  { tipo: "riesgos_operacionales",     cargos: null, nivel: "obligatorio" },
  { tipo: "induccion_interna",         cargos: null, nivel: "obligatorio" },
  { tipo: "curso_epp",                 cargos: null, nivel: "obligatorio" },
  { tipo: "entrega_epp",               cargos: null, nivel: "obligatorio" },
  { tipo: "recepcion_riohs",           cargos: null, nivel: "obligatorio" },
  { tipo: "odi",                       cargos: null, nivel: "obligatorio" },
  { tipo: "titulo_estudios",           cargos: null, nivel: "obligatorio" },
  { tipo: "irl_empresa",               cargos: null, nivel: "obligatorio" },
  { tipo: "irl_cliente",               cargos: null, nivel: "obligatorio" },
  { tipo: "certificado_antecedentes",  cargos: null, nivel: "obligatorio" },
  { tipo: "certificado_residencia",    cargos: null, nivel: "obligatorio" },
  { tipo: "afiliacion_afp",            cargos: null, nivel: "obligatorio" },
  { tipo: "afiliacion_salud",          cargos: null, nivel: "obligatorio" },
  { tipo: "certificado_cotizaciones",  cargos: null, nivel: "obligatorio" },
  { tipo: "cv",                        cargos: null, nivel: "obligatorio" },

  // Por cargo — las tres reglas que la planilla sí definía
  { tipo: "manipulacion_alimentos",    cargos: CARGOS_COCINA,      nivel: "obligatorio" },
  { tipo: "licencia_conducir",         cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
  { tipo: "curso_4x4",                 cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
  { tipo: "conduccion_defensiva",      cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
  { tipo: "psicosensotecnico",         cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },

  // Depende de la faena, no del cargo
  { tipo: "altura_geografica",         cargos: null, nivel: "obligatorio", sobreMsnm: 3000 },

  // Depende de la persona
  { tipo: "finiquito_mandante",        cargos: null, nivel: "obligatorio", condicion: "trabajo_previo_mandante" },
  { tipo: "poliza_muerte_accidental",  cargos: null, nivel: "obligatorio", condicion: "contrato_indefinido" },
  { tipo: "poliza_salud_dental",       cargos: null, nivel: "obligatorio", condicion: "contrato_indefinido" },
  { tipo: "poliza_muerte_natural",     cargos: null, nivel: "obligatorio", condicion: "contrato_indefinido" },

  // "Si aplica" en la planilla: se pide, pero no bloquea
  { tipo: "finiquito",                 cargos: null, nivel: "deseable" },
  { tipo: "ley_trabajo_pesado",        cargos: null, nivel: "deseable" },
  { tipo: "registro_discapacidad",     cargos: null, nivel: "deseable" },
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
};

/** ¿Este requisito le corre a este trabajador en concreto? */
export function requisitoAplica(
  req: { condicion: string | null },
  cond: CondicionesTrabajador,
): boolean {
  switch (req.condicion) {
    case "contrato_indefinido":     return cond.contratoIndefinido;
    case "trabajo_previo_mandante": return cond.trabajoPrevioMandante;
    default:                        return true;
  }
}
