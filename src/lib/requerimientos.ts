/**
 * Requerimientos de personal: estados, semáforo y cálculos.
 *
 * Funciones puras, sin base de datos, para que la pantalla, el export y el
 * aviso diario calculen lo mismo. Si cada uno contara las vacantes a su
 * manera, el tablero y el Excel terminarían diciendo cosas distintas.
 */

// ─── Estados de la solicitud ─────────────────────────────────────────────────

export const ESTADOS_SOLICITUD = [
  "solicitado", "reclutamiento", "entrevistas", "seleccionado", "examenes",
  "contratado", "cerrado", "desistido",
] as const;
export type EstadoSolicitud = typeof ESTADOS_SOLICITUD[number];

export const ESTADO_SOLICITUD_LABEL: Record<EstadoSolicitud, string> = {
  solicitado:    "Solicitado",
  reclutamiento: "En reclutamiento",
  entrevistas:   "Entrevistas",
  seleccionado:  "Seleccionado",
  examenes:      "Exámenes / Acreditación",
  contratado:    "Contratado",
  cerrado:       "Cerrado",
  desistido:     "Desistido / Cancelado",
};

/** Los que todavía buscan gente. Contratado ya no: las vacantes están cubiertas. */
export const ESTADOS_ABIERTOS: EstadoSolicitud[] = [
  "solicitado", "reclutamiento", "entrevistas", "seleccionado", "examenes",
];

/** Columnas del tablero. Cerrado y Desistido no: con el tiempo serían las más
 *  largas y taparían el trabajo pendiente. Se ven en la tabla. */
export const COLUMNAS_TABLERO: EstadoSolicitud[] = [...ESTADOS_ABIERTOS, "contratado"];

export function esEstadoSolicitud(v: string): v is EstadoSolicitud {
  return (ESTADOS_SOLICITUD as readonly string[]).includes(v);
}

export function estaAbierta(estado: string): boolean {
  return (ESTADOS_ABIERTOS as string[]).includes(estado);
}

export function estaTerminada(estado: string): boolean {
  return estado === "cerrado" || estado === "desistido";
}

export function etiquetaSolicitud(estado: string): string {
  return esEstadoSolicitud(estado) ? ESTADO_SOLICITUD_LABEL[estado] : estado;
}

// ─── Estados del postulante ──────────────────────────────────────────────────

export const ESTADOS_POSTULANTE = [
  "postulado", "preseleccionado", "entrevistado", "aprobado", "examenes",
  "contratado", "descartado",
] as const;
export type EstadoPostulante = typeof ESTADOS_POSTULANTE[number];

export const ESTADO_POSTULANTE_LABEL: Record<EstadoPostulante, string> = {
  postulado:       "Postulado",
  preseleccionado: "Preseleccionado",
  entrevistado:    "Entrevistado",
  aprobado:        "Aprobado por solicitante",
  examenes:        "Exámenes / Acreditación",
  contratado:      "Contratado",
  descartado:      "Descartado",
};

export function esEstadoPostulante(v: string): v is EstadoPostulante {
  return (ESTADOS_POSTULANTE as readonly string[]).includes(v);
}

export function etiquetaPostulante(estado: string): string {
  return esEstadoPostulante(estado) ? ESTADO_POSTULANTE_LABEL[estado] : estado;
}

/** Sigue en carrera: ni contratado ni descartado. */
export function postulanteEnProceso(estado: string): boolean {
  return estado !== "contratado" && estado !== "descartado";
}

/** Desde dónde el solicitante puede aprobar o rechazar a un candidato. */
export const APROBABLE_DESDE: EstadoPostulante[] = ["preseleccionado", "entrevistado"];

/**
 * Estados a los que solo se llega con la aprobación del solicitante.
 *
 * Es el control del proceso: RRHH no puede mandar a exámenes, ni contratar, a
 * alguien que quien pidió el cargo no vio. Un administrador puede aprobar si
 * el solicitante no está.
 */
export const REQUIEREN_APROBACION: EstadoPostulante[] = ["examenes", "contratado"];

// ─── Avance automático ───────────────────────────────────────────────────────

/** Hasta dónde llega una solicitud por tener un postulante en ese estado. */
const NIVEL_POR_POSTULANTE: Record<EstadoPostulante, EstadoSolicitud | null> = {
  postulado:       "reclutamiento",
  preseleccionado: "reclutamiento",
  entrevistado:    "entrevistas",
  aprobado:        "seleccionado",
  examenes:        "examenes",
  // Uno contratado con vacantes aún abiertas: la solicitud ya pasó por
  // exámenes. Contratado como estado lo decide el conteo de vacantes.
  contratado:      "examenes",
  descartado:      null,
};

function rango(estado: EstadoSolicitud): number {
  return ESTADOS_SOLICITUD.indexOf(estado);
}

export function vacantesCubiertas(postulantes: Array<{ estado: string }>): number {
  return postulantes.filter(p => p.estado === "contratado").length;
}

/**
 * El estado que le corresponde a la solicitud según sus postulantes.
 *
 * Avanza sola, nunca retrocede: RRHH puede haberla adelantado a mano y eso
 * se respeta. La única vuelta atrás automática es salir de Contratado cuando
 * deja de tener todas las vacantes cubiertas (un contratado que se corrigió,
 * o vacantes que se aumentaron), porque Contratado con un puesto vacío es un
 * dato falso.
 *
 * Devuelve `null` si no hay que cambiar nada. Cerrado y Desistido no se
 * tocan nunca.
 */
export function estadoCalculado(
  actual: string,
  vacantes: number,
  postulantes: Array<{ estado: string }>,
): EstadoSolicitud | null {
  if (!esEstadoSolicitud(actual) || estaTerminada(actual)) return null;

  if (vacantesCubiertas(postulantes) >= vacantes) {
    return actual === "contratado" ? null : "contratado";
  }

  let nivel: EstadoSolicitud = "solicitado";
  for (const p of postulantes) {
    const n = esEstadoPostulante(p.estado) ? NIVEL_POR_POSTULANTE[p.estado] : null;
    if (n && rango(n) > rango(nivel)) nivel = n;
  }

  if (actual === "contratado") return nivel === "solicitado" ? "reclutamiento" : nivel;
  return rango(nivel) > rango(actual) ? nivel : null;
}

// ─── Semáforo ────────────────────────────────────────────────────────────────

export type SemaforoReq = "verde" | "amarillo" | "rojo" | "ninguno";

export const SEMAFORO_REQ_STYLE: Record<SemaforoReq, { bg: string; color: string; border: string; barra: string }> = {
  verde:    { bg: "#e8f7ef", color: "#146c3d", border: "#b6e8c8", barra: "#16a34a" },
  amarillo: { bg: "#fff4dc", color: "#9a6300", border: "#f5d98e", barra: "#eab308" },
  rojo:     { bg: "#fce9e8", color: "#9e2f23", border: "#f5c0bb", barra: "#dc2626" },
  ninguno:  { bg: "#f1f5f9", color: "#475569", border: "#cbd5e1", barra: "#cbd5e1" },
};

const DIA_MS = 86_400_000;

/** Días calendario de hoy a la fecha. Negativo = ya pasó. */
export function diasHasta(fecha: Date, hoy = new Date()): number {
  const a = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const f = new Date(fecha);
  const b = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
  return Math.round((b - a) / DIA_MS);
}

/**
 * Verde con más de 15 días, amarillo de 7 a 15, rojo con menos de 7 o
 * vencida. Las solicitudes ya cubiertas o terminadas no llevan semáforo: no
 * hay plazo que cuidar.
 */
export function semaforoDe(r: { estado: string; fechaRequerida: Date }, hoy = new Date()): SemaforoReq {
  if (!estaAbierta(r.estado)) return "ninguno";
  const d = diasHasta(r.fechaRequerida, hoy);
  if (d < 7) return "rojo";
  if (d <= 15) return "amarillo";
  return "verde";
}

export function textoPlazo(r: { estado: string; fechaRequerida: Date }, hoy = new Date()): string {
  if (r.estado === "contratado") return "Cubierta";
  if (r.estado === "cerrado") return "Cerrada";
  if (r.estado === "desistido") return "Desistida";
  const d = diasHasta(r.fechaRequerida, hoy);
  if (d < 0) return `vencida ${-d} d`;
  if (d === 0) return "hoy";
  return `${d} día${d === 1 ? "" : "s"}`;
}

// ─── Indicadores ─────────────────────────────────────────────────────────────

export type ParaIndicadores = {
  estado: string;
  vacantes: number;
  fechaRequerida: Date;
  createdAt: Date;
  contratadoEn: Date | null;
  cubiertas: number;
};

export function indicadores(filas: ParaIndicadores[], hoy = new Date()) {
  const abiertas = filas.filter(r => estaAbierta(r.estado));
  const atrasadas = abiertas.filter(r => diasHasta(r.fechaRequerida, hoy) < 0).length;
  const vacantesPedidas = abiertas.reduce((s, r) => s + r.vacantes, 0);
  const porCubrir = abiertas.reduce((s, r) => s + Math.max(0, r.vacantes - r.cubiertas), 0);

  // Por solicitud: desde que se pidió hasta que se cubrió la última vacante.
  const tiempos = filas
    .filter(r => r.contratadoEn)
    .map(r => Math.max(0, Math.round((new Date(r.contratadoEn!).getTime() - new Date(r.createdAt).getTime()) / DIA_MS)));
  const promedio = tiempos.length > 0 ? Math.round(tiempos.reduce((s, t) => s + t, 0) / tiempos.length) : null;

  return { abiertas: abiertas.length, atrasadas, vacantesPedidas, porCubrir, promedio, contratadas: tiempos.length };
}

// ─── Formato ─────────────────────────────────────────────────────────────────

export function codigoReq(numero: number): string {
  return `REQ-${String(numero).padStart(4, "0")}`;
}

export const TURNOS = ["7x7", "10x10", "14x14", "5x2"] as const;

export const PRIORIDADES = [
  { valor: "alta", label: "Alta", color: "#b42318" },
  { valor: "media", label: "Media", color: "#9a6300" },
  { valor: "baja", label: "Baja", color: "#475569" },
] as const;

export function prioridadDe(valor: string) {
  return PRIORIDADES.find(p => p.valor === valor) ?? PRIORIDADES[1];
}

/** Orden de trabajo: lo más urgente arriba, y a igual plazo, la prioridad. */
export function ordenUrgencia(
  a: { fechaRequerida: Date; prioridad: string },
  b: { fechaRequerida: Date; prioridad: string },
): number {
  const fa = new Date(a.fechaRequerida).getTime(), fb = new Date(b.fechaRequerida).getTime();
  if (fa !== fb) return fa - fb;
  const peso = (p: string) => (p === "alta" ? 0 : p === "media" ? 1 : 2);
  return peso(a.prioridad) - peso(b.prioridad);
}

// ─── Filtros ─────────────────────────────────────────────────────────────────

export type FiltrosReq = {
  proyecto?: string;
  cargo?: string;
  solicitante?: string;
  /** en-curso (por defecto) | abiertas | terminadas | todas | un estado */
  estado?: string;
  prioridad?: string;
  /** Rango sobre la fecha requerida, `YYYY-MM-DD`. */
  desde?: string;
  hasta?: string;
};

export const FILTROS_ESTADO = [
  { valor: "en-curso", label: "En curso (sin cerradas)" },
  { valor: "abiertas", label: "Abiertas (sin cubrir)" },
  ...ESTADOS_SOLICITUD.map(e => ({ valor: e, label: ESTADO_SOLICITUD_LABEL[e] })),
  { valor: "terminadas", label: "Cerradas y desistidas" },
  { valor: "todas", label: "Todas" },
];

/**
 * El mismo filtro para el tablero, la tabla y el Excel: lo que se exporta es
 * exactamente lo que se estaba mirando.
 */
export function filtrarRequerimientos<T extends {
  estado: string; proyectoId: string; cargoId: string; solicitanteNombre: string;
  prioridad: string; fechaRequerida: Date;
}>(filas: T[], f: FiltrosReq): T[] {
  const estado = f.estado || "en-curso";
  const dia = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const desde = dia(f.desde), hasta = dia(f.hasta);

  return filas.filter(r => {
    if (f.proyecto && r.proyectoId !== f.proyecto) return false;
    if (f.cargo && r.cargoId !== f.cargo) return false;
    if (f.solicitante && r.solicitanteNombre !== f.solicitante) return false;
    if (f.prioridad && r.prioridad !== f.prioridad) return false;
    if (estado === "en-curso" && estaTerminada(r.estado)) return false;
    if (estado === "abiertas" && !estaAbierta(r.estado)) return false;
    if (estado === "terminadas" && !estaTerminada(r.estado)) return false;
    if (esEstadoSolicitud(estado) && r.estado !== estado) return false;
    const fecha = new Date(r.fechaRequerida).toISOString().slice(0, 10);
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  });
}

/** Los filtros como query string, para el enlace de exportación y la vista. */
export function queryDeFiltros(f: FiltrosReq, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
