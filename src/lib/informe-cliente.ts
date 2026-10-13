/**
 * Datos del informe diario para el cliente y proyecciones internas.
 *
 * REGLA: el cliente ve exactamente los datos que ya recibe en el formato
 * REG-OP-OPE-001 —ocupación, combustible disponible, niveles de estanques en
 * m³, basura, horómetros, internet, congelamiento, bidones, BSALE, desglose y
 * servicios—, solo que mejor presentados. Un gráfico de su historia no le
 * revela nada nuevo: ya recibió cada uno de esos días.
 *
 * Lo que NO sale al cliente: consumos diarios, capacidad de los estanques y
 * las proyecciones de autonomía. Esas se calculan en `proyeccionesInternas` y
 * solo se muestran dentro de Nómade. Si algún día se quiere que el cliente
 * vea una, se agrega a propósito a la hoja; no se cuela sola.
 */

export type PuntoSerie = { fecha: string; valor: number | null };

/**
 * Desde cuándo los informes del cliente salen de la plataforma.
 *
 * Las tendencias solo usan informes desde esta fecha. Antes el cliente
 * recibía un Excel que se llenaba aparte y no siempre coincidía con lo
 * guardado acá —el 08-10-2026 se le informó basura al 10% y la plataforma
 * dice 16%—. Si el gráfico mostrara esa historia, el cliente vería cifras
 * que contradicen los informes que ya tiene en su correo.
 */
export const INICIO_INFORME_CLIENTE = new Date("2026-10-14T00:00:00Z");

/** Mínimo de informes para que una tendencia diga algo. */
export const MINIMO_TENDENCIA = 3;

export type InformeHistorico = {
  date: Date;
  peopleCount: number;
  fuelLiters: number;
  fuelRemainingLiters: number;
  generator1Hours: number;
  generator2Hours: number;
  potableWaterTankLevelM3: number | null;
  blackWaterTankLevelM3: number | null;
  blackWaterRemovedM3: number;
  potableWaterDeliveredM3: number;
  waterLiters: number;
  wasteFillPercent: number;
};

const DIA_MS = 86_400_000;

function etiquetaDia(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Las series que ve el cliente: solo campos que ya están en su formato. */
export function seriesCliente(historia: InformeHistorico[], desde: Date = INICIO_INFORME_CLIENTE) {
  const orden = [...historia]
    .filter(r => r.date.getTime() >= desde.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const map = (f: (r: InformeHistorico) => number | null): PuntoSerie[] =>
    orden.map(r => ({ fecha: etiquetaDia(r.date), valor: f(r) }));
  return {
    ocupacion: map(r => r.peopleCount),
    combustible: map(r => r.fuelRemainingLiters),
    aguaPotable: map(r => r.potableWaterTankLevelM3),
    aguasNegras: map(r => r.blackWaterTankLevelM3),
    basura: map(r => r.wasteFillPercent),
  };
}

export function mediana(valores: number[]): number | null {
  const v = valores.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export type Proyeccion = {
  /** Lo que se proyecta, en palabras. */
  nombre: string;
  /** Días estimados, o null si no hay datos suficientes para afirmarlo. */
  dias: number | null;
  /** Cómo se calculó, para que nadie tenga que adivinarlo. */
  base: string;
};

/**
 * Proyecciones de autonomía. SOLO PARA USO INTERNO.
 *
 * Se usa la mediana de los últimos días y no el promedio: el consumo de
 * combustible se informa casi siempre como 190 L, pero hay días con 3.323
 * —una recarga anotada como consumo—, y un promedio con eso dentro dice que
 * el combustible se acaba mañana. Con menos de tres datos válidos no se
 * proyecta nada: una estimación sin base es peor que un "—".
 */
export function proyeccionesInternas(
  historia: InformeHistorico[],
  capacidades: { aguaNegrasM3: number | null },
  ventanaDias = 7,
): Proyeccion[] {
  const orden = [...historia].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(-(ventanaDias + 1));
  const hoy = orden[orden.length - 1];
  if (!hoy) return [];

  // Variaciones entre informes de días consecutivos (un hueco no es un día).
  const pares: Array<[InformeHistorico, InformeHistorico]> = [];
  for (let i = 1; i < orden.length; i++) {
    if (Math.round((orden[i].date.getTime() - orden[i - 1].date.getTime()) / DIA_MS) === 1) {
      pares.push([orden[i - 1], orden[i]]);
    }
  }
  const conBase = (valores: number[]) => (valores.length >= 3 ? mediana(valores) : null);
  const dias = (disponible: number | null, porDia: number | null) =>
    disponible == null || porDia == null || porDia <= 0 ? null : Math.max(0, disponible / porDia);
  const n = orden.slice(-ventanaDias);

  const combustibleDia = conBase(n.map(r => r.fuelLiters).filter(v => v > 0));
  const aguaDia = conBase(n.map(r => r.waterLiters).filter(v => v > 0));
  const negrasDia = conBase(pares
    .map(([a, b]) => (b.blackWaterTankLevelM3 ?? NaN) - (a.blackWaterTankLevelM3 ?? NaN) + b.blackWaterRemovedM3)
    .filter(v => Number.isFinite(v) && v > 0));
  // El contenedor se vacía de golpe: esas bajadas no son llenado.
  const basuraDia = conBase(pares
    .map(([a, b]) => b.wasteFillPercent - a.wasteFillPercent)
    .filter(v => v > 0 && v < 50));

  const espacioNegras = capacidades.aguaNegrasM3 != null && hoy.blackWaterTankLevelM3 != null
    ? capacidades.aguaNegrasM3 - hoy.blackWaterTankLevelM3 : null;

  const fmt = (v: number | null, u: string) => (v == null ? "sin datos suficientes" : `${v.toLocaleString("es-CL", { maximumFractionDigits: 1 })} ${u}`);

  return [
    { nombre: "Autonomía de combustible", dias: dias(hoy.fuelRemainingLiters, combustibleDia),
      base: `${hoy.fuelRemainingLiters} L disponibles ÷ consumo mediano de ${fmt(combustibleDia, "L/día")}` },
    { nombre: "Autonomía de agua potable", dias: dias(hoy.potableWaterTankLevelM3, aguaDia),
      base: `${hoy.potableWaterTankLevelM3 ?? "—"} m³ en estanque ÷ consumo mediano del medidor de ${fmt(aguaDia, "m³/día")}` },
    { nombre: "Días para llenar aguas negras", dias: dias(espacioNegras, negrasDia),
      base: capacidades.aguaNegrasM3 == null
        ? "falta configurar la capacidad del estanque en Administración"
        : `${espacioNegras ?? "—"} m³ libres ÷ generación mediana de ${fmt(negrasDia, "m³/día")} (descontando retiros)` },
    { nombre: "Días para llenar el contenedor de basura", dias: dias(100 - hoy.wasteFillPercent, basuraDia),
      base: `${100 - hoy.wasteFillPercent}% libre ÷ llenado mediano de ${fmt(basuraDia, "%/día")}` },
  ];
}
