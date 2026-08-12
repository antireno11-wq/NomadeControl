/**
 * DdD — Diálogo de Desempeño.
 *
 * Los campos derivados NO se persisten: se calculan siempre contra la fecha
 * de hoy. Guardar "días de atraso" en la base significaría que el número
 * queda viejo apenas cambia el día, que es exactamente lo que hace inútil a
 * la planilla cuando alguien la abre el jueves.
 */

export type Semaforo = "cerrado" | "atrasado" | "por_vencer" | "en_plazo";

export const SEMAFORO_STYLE: Record<Semaforo, { bg: string; color: string; border: string; label: string }> = {
  cerrado:    { bg: "#e8f7ef", color: "#146c3d", border: "#b6e8c8", label: "Cerrado" },
  atrasado:   { bg: "#fce9e8", color: "#9e2f23", border: "#f5c0bb", label: "Atrasado" },
  por_vencer: { bg: "#fff4dc", color: "#9a6300", border: "#f5d98e", label: "Por vencer" },
  en_plazo:   { bg: "#f1f5f9", color: "#475569", border: "#cbd5e1", label: "En plazo" },
};

export const TIPOS_REUNION = [
  { valor: "daily",             label: "Daily de operaciones" },
  { valor: "comite_semanal",    label: "Comité semanal" },
  { valor: "comite_mensual",    label: "Comité mensual" },
  { valor: "bilateral",         label: "Bilateral" },
  { valor: "arranque_contrato", label: "Arranque de contrato" },
  { valor: "cierre_contrato",   label: "Cierre de contrato" },
] as const;

export function etiquetaTipoReunion(tipo: string): string {
  return TIPOS_REUNION.find(t => t.valor === tipo)?.label ?? tipo;
}

/** Categorías iniciales de `oportunidad`. Editables desde Administración. */
export const CATEGORIAS_SEED = [
  "Abastecimiento", "Acreditación", "Documentación", "Dotación", "Logística",
  "Capacitación", "Finanzas", "Comercial", "Estándares", "Procedimiento",
  "Onboarding", "Organización", "Personas", "SSO", "Planificación",
  "Presupuesto", "Equipamiento", "Plataforma", "Automatización", "Otro",
];

/** KPI iniciales del DdD: cumplimiento diario binario. */
export const KPI_SEED: Array<{ parametro: string; nombre: string }> = [
  { parametro: "HSE",          nombre: "Charla diaria de 5 minutos (por faena)" },
  { parametro: "HSE",          nombre: "Flash informativo e investigación de incidentes" },
  { parametro: "HSE",          nombre: "Inspección de seguridad (Prevención)" },
  { parametro: "OPERACIÓN",    nombre: "Reporte Diario de Faena antes de 20:00" },
  { parametro: "OPERACIÓN",    nombre: "Ronda diaria del supervisor con checklist firmado" },
  { parametro: "OPERACIÓN",    nombre: "Registro de temperaturas y contramuestras" },
  { parametro: "ACREDITACIÓN", nombre: "Movilizaciones con pase aprobado y verificado" },
  { parametro: "ACREDITACIÓN", nombre: "Revisión de la matriz de vencimientos" },
  { parametro: "GESTIÓN",      nombre: "Coordinación diaria 08:30 realizada" },
  { parametro: "GESTIÓN",      nombre: "Comité de contratos (lunes 09:00)" },
  { parametro: "GESTIÓN",      nombre: "Compromisos del DdD cerrados en fecha" },
];

// ─── Fechas ────────────────────────────────────────────────────────────

const DIA_MS = 86_400_000;

/** Medianoche UTC del día de esa fecha, para restar días sin arrastrar horas. */
function aDia(fecha: Date): number {
  return Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
}

/**
 * Semana ISO 8601: la semana empieza el lunes y la semana 1 es la que
 * contiene el primer jueves del año. Es la convención que usa el DdD, y no
 * coincide con "número de semana" a secas en enero ni en diciembre.
 */
export function semanaIso(fecha: Date): { anio: number; semana: number } {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  // Al jueves de esa semana: define a qué año ISO pertenece.
  const diaSemana = (d.getUTCDay() + 6) % 7;         // lunes = 0
  d.setUTCDate(d.getUTCDate() - diaSemana + 3);
  const anio = d.getUTCFullYear();
  const primerJueves = new Date(Date.UTC(anio, 0, 4));
  const diaPrimerJueves = (primerJueves.getUTCDay() + 6) % 7;
  primerJueves.setUTCDate(primerJueves.getUTCDate() - diaPrimerJueves + 3);
  const semana = 1 + Math.round((d.getTime() - primerJueves.getTime()) / (7 * DIA_MS));
  return { anio, semana };
}

/** Lunes y domingo de una semana ISO, en UTC. */
export function rangoSemana(anio: number, semana: number): { desde: Date; hasta: Date } {
  const primerJueves = new Date(Date.UTC(anio, 0, 4));
  const diaPrimerJueves = (primerJueves.getUTCDay() + 6) % 7;
  const lunesSemana1 = new Date(primerJueves.getTime() - diaPrimerJueves * DIA_MS);
  const desde = new Date(lunesSemana1.getTime() + (semana - 1) * 7 * DIA_MS);
  const hasta = new Date(desde.getTime() + 6 * DIA_MS);
  return { desde, hasta };
}

// ─── Campos calculados del compromiso ──────────────────────────────────

export type CompromisoCalculable = {
  estado: number;
  fechaCierre: Date;
  fecha2doCompromiso: Date | null;
};

/**
 * La fecha contra la que se mide: la reprogramada si existe, la original si
 * no. La original nunca se toca, por eso hace falta esta.
 */
export function fechaEfectiva(c: CompromisoCalculable): Date {
  return c.fecha2doCompromiso ?? c.fechaCierre;
}

/** Días de atraso. Cero si está cerrado o si todavía no vence. */
export function diasAtraso(c: CompromisoCalculable, hoy = new Date()): number {
  if (c.estado === 1) return 0;
  const dias = Math.floor((aDia(hoy) - aDia(fechaEfectiva(c))) / DIA_MS);
  return Math.max(0, dias);
}

export function semaforoDe(c: CompromisoCalculable, hoy = new Date()): Semaforo {
  if (c.estado === 1) return "cerrado";
  if (diasAtraso(c, hoy) > 0) return "atrasado";
  // Vence hoy o mañana: hay que verlo venir con un día de anticipación.
  const margen = aDia(hoy) + DIA_MS;
  return aDia(fechaEfectiva(c)) <= margen ? "por_vencer" : "en_plazo";
}

/**
 * Cumplimiento a la fecha = cerrados / (cerrados + atrasados).
 *
 * Deliberadamente NO cuenta los compromisos cuyo plazo todavía no vence:
 * castigar por algo que aún no se debía hacer haría que el indicador baje
 * cada vez que se agrega trabajo, y nadie volvería a registrar compromisos.
 */
export function cumplimientoALaFecha(
  compromisos: CompromisoCalculable[],
  hoy = new Date(),
): { cerrados: number; atrasados: number; abiertos: number; vivos: number; porcentaje: number } {
  let cerrados = 0, atrasados = 0, abiertos = 0;
  for (const c of compromisos) {
    if (c.estado === 1) { cerrados++; continue; }
    abiertos++;
    if (diasAtraso(c, hoy) > 0) atrasados++;
  }
  const base = cerrados + atrasados;
  return {
    cerrados, atrasados, abiertos,
    vivos: compromisos.length,
    porcentaje: base === 0 ? 100 : Math.round((cerrados / base) * 100),
  };
}

/**
 * ¿Este compromiso estuvo vivo durante esa semana?
 *
 * La vista semanal NO filtra por fecha de captura: un compromiso abierto
 * aparece en todas las semanas desde que se capturó hasta que se cierra. Es
 * la diferencia entre un acta —que solo muestra lo que se dijo ese día— y
 * un sistema de arrastre.
 */
export function vivoEnSemana(
  c: { fechaCaptura: Date; estado: number; fechaCierreReal: Date | null },
  anio: number,
  semana: number,
): boolean {
  const { desde, hasta } = rangoSemana(anio, semana);
  if (aDia(c.fechaCaptura) > aDia(hasta)) return false;          // aún no existía
  if (c.estado !== 1) return true;                               // sigue abierto
  if (!c.fechaCierreReal) return true;                           // cerrado sin fecha: se muestra igual
  return aDia(c.fechaCierreReal) >= aDia(desde);                 // se cerró durante o después
}

/** Fecha a `YYYY-MM-DD` en UTC, para inputs y exportación. */
export function aInputDate(fecha: Date | null | undefined): string {
  if (!fecha) return "";
  return new Date(fecha).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` a mediodía UTC, para que no se corra de día por zona horaria. */
export function deInputDate(valor: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const [y, m, d] = valor.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
