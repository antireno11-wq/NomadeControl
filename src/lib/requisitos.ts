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
// El auxiliar manipula alimentos igual que el ayudante: se le exige el mismo
// certificado. Se creó desde Administración para Monte Mina.
const CARGOS_COCINA      = ["Maestro de Cocina", "Ayudante de Cocina", "Auxiliar de Cocina"];

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
  /** Se cumple con cualquiera de los requisitos que compartan esta clave. */
  alternativaDe?: string;
  /** Plazo que exige este mandante, en meses desde la emisión. */
  vigenciaMeses?: number;
  /** Lo que el documento tiene que traer para que el mandante lo acepte. */
  nota?: string;
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
  // El mandante lo pide como UN certificado: "Examen Ocupacional y de Altura
  // Geográfica". Es el mismo papel de la mutualidad, así que cualquiera de los
  // dos tipos lo satisface.
  { tipo: "examen_ocupacional",        cargos: null, nivel: "obligatorio", alternativaDe: "examen_mutualidad" },
  { tipo: "altura_geografica",         cargos: null, nivel: "obligatorio", alternativaDe: "examen_mutualidad" },
  { tipo: "recepcion_riohs",           cargos: null, nivel: "obligatorio" },
  // "Acreditación profesional y técnica (o Declaración Jurada de
  // Competencias)": el mandante acepta una u otra.
  { tipo: "declaracion_jurada",        cargos: null, nivel: "obligatorio", alternativaDe: "competencias" },
  { tipo: "certificacion_competencias", cargos: null, nivel: "obligatorio", alternativaDe: "competencias" },
  { tipo: "entrega_epp",               cargos: null, nivel: "obligatorio" },
  { tipo: "examen_alcohol_drogas",     cargos: null, nivel: "obligatorio" },

  // Entrenamientos generales
  { tipo: "curso_primeros_auxilios",   cargos: null, nivel: "obligatorio" },
  { tipo: "curso_extintores",          cargos: null, nivel: "obligatorio" },
  { tipo: "curso_epp",                 cargos: null, nivel: "obligatorio" },
  { tipo: "entrenamientos_especificos", cargos: null, nivel: "obligatorio" },

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

/**
 * Lo que Transelec exige para acreditar en Monte Mina. Sale de la planilla
 * "requisitos Montemina" que mandó el mandante.
 *
 * La diferencia con Anglo son los plazos: Transelec pone vigencia a papeles
 * que para Anglo no vencen nunca —RIOHS, EPP, ODI, la inducción—, y por eso
 * la vigencia va en el requisito y no en el tipo.
 *
 * El punto 1.8, "Autorización de Transelec para funciones críticas", NO se
 * siembra: la planilla no dice cuáles cargos son funciones críticas y remite
 * a un "ítem II" que no venía en el archivo. Exigírselo a todos bloquearía
 * a la dotación entera por un papel que a la mayoría no le corresponde.
 */
export const REGLAS_MANDANTE_TRANSELEC: ReglaSeed[] = [
  // 1.1 — La ODI se reemplazó por el IRL (DS 44, vigente desde 2025), así que
  // quien entró después trae IRL y no ODI. Transelec todavía lo escribe como
  // ODI; se aceptan los dos.
  { tipo: "odi",               cargos: null, nivel: "obligatorio", alternativaDe: "odi_irl", vigenciaMeses: 36,
    nota: "Acorde al cargo del contrato. Nombre, RUT y firma del trabajador y del relator. Duración mínima 60 minutos." },
  { tipo: "irl_empresa",       cargos: null, nivel: "obligatorio", alternativaDe: "odi_irl", vigenciaMeses: 36,
    nota: "Acorde al cargo del contrato. Nombre, RUT y firma del trabajador y del relator. Duración mínima 60 minutos." },
  // 1.2 y 1.3
  { tipo: "recepcion_riohs",   cargos: null, nivel: "obligatorio", vigenciaMeses: 36,
    nota: "Nombre, RUT y firma del trabajador." },
  { tipo: "entrega_epp",       cargos: null, nivel: "obligatorio", vigenciaMeses: 36,
    nota: "Nombre, RUT y firma del trabajador. EPP de acuerdo al cargo y funciones críticas, actualizada." },
  // 1.4 y 1.5
  { tipo: "contrato_trabajo",  cargos: null, nivel: "obligatorio",
    nota: "Con los 10 elementos mínimos del Código del Trabajo y firmado por ambas partes." },
  { tipo: "anexo_contrato",    cargos: null, nivel: "obligatorio", condicion: "contrato_vencido" },
  { tipo: "cedula_identidad",  cargos: null, nivel: "obligatorio", nota: "Por ambos lados." },
  // 1.6
  { tipo: "induccion_mandante", cargos: null, nivel: "obligatorio", vigenciaMeses: 36,
    nota: "Inducción para ingresar a obras o faenas de Transelec. Nombre, RUT y firma del trabajador y del relator." },
  // 1.7 — "Según corresponda": altura física, geográfica o batería básica,
  // de acuerdo al trabajo. Cualquiera de los tres satisface el requisito; que
  // sea el correcto para ese trabajo lo verifica quien valida.
  { tipo: "examen_ocupacional", cargos: null, nivel: "obligatorio", alternativaDe: "examen_mutualidad",
    nota: "Solo de mutualidad (IST, ISL, CCHC, ACHS) y a nombre del empleador. Batería básica, o altura física, geográfica o espacios confinados según el trabajo." },
  { tipo: "altura_fisica",      cargos: null, nivel: "obligatorio", alternativaDe: "examen_mutualidad",
    nota: "Solo de mutualidad (IST, ISL, CCHC, ACHS) y a nombre del empleador." },
  { tipo: "altura_geografica",  cargos: null, nivel: "obligatorio", alternativaDe: "examen_mutualidad",
    nota: "Solo de mutualidad (IST, ISL, CCHC, ACHS) y a nombre del empleador." },
  { tipo: "examen_alcohol_drogas", cargos: null, nivel: "obligatorio",
    nota: "Transelec exige que todos los exámenes de salud lo incluyan. Solo de mutualidad." },
  // 1.9 — Sin vigencia fija a propósito: 12 meses si lo dictó una mutualidad,
  // lo que diga el documento si fue una OTEC. Manda la fecha impresa.
  { tipo: "curso_riesgos_electricos", cargos: null, nivel: "obligatorio",
    nota: "Si es de mutualidad (IST, ISL, CCHC, ACHS), a nombre del empleador y vence a los 12 meses. Si es de OTEC o CFT, vale lo que indique el documento." },

  // 2 — Conductores
  { tipo: "licencia_conducir",  cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
  { tipo: "psicosensotecnico",  cargos: CARGOS_CONDUCTORES, nivel: "obligatorio" },
  // 2.2 y 2.3 son el mismo requisito con dos alcances: el teórico-práctico
  // habilita fuera del asfalto y dura 24 meses; el solo teórico, solo sobre
  // asfalto y un mes. Cualquiera de los dos cumple.
  { tipo: "curso_4x4",            cargos: CARGOS_CONDUCTORES, nivel: "obligatorio", alternativaDe: "manejo_defensivo", vigenciaMeses: 24,
    nota: "Teórico y práctico. Habilita para rutas fuera del asfalto (off road 4x4)." },
  { tipo: "conduccion_defensiva", cargos: CARGOS_CONDUCTORES, nivel: "obligatorio", alternativaDe: "manejo_defensivo", vigenciaMeses: 1,
    nota: "Solo teórico: dura un mes y autoriza únicamente conducción sobre asfalto." },
];

/** Se crean solos al arrancar, para no armarlos a mano en la interfaz. */
export const PROGRAMAS_SEED: ProgramaSeed[] = [
  { mandante: "Anglo American", proyecto: "Agua Verde", faena: "Los Bronces", ambito: "mandante", reglas: REGLAS_MANDANTE_ANGLO },
  { mandante: "Transelec", proyecto: "Monte Mina", faena: "Monte Mina", ambito: "mandante", reglas: REGLAS_MANDANTE_TRANSELEC },
  { mandante: "Servicios Integrales Nómade Chile", proyecto: "Contratación", ambito: "interno", reglas: REGLAS_INTERNAS_NOMADE },
];

/** Las reglas de un proyecto, según el programa que lo creó. */
export function reglasDelPrograma(mandante: string, proyecto: string): ReglaSeed[] | null {
  return PROGRAMAS_SEED.find(p => p.mandante === mandante && p.proyecto === proyecto)?.reglas ?? null;
}

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
