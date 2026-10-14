import React from "react";
import type { PuntoSerie } from "@/lib/informe-cliente";

/**
 * La hoja del informe diario para el cliente (REG-OP-OPE-001).
 *
 * Va aparte de la página para poder dibujarla sin sesión y revisarla. Recibe
 * SOLO datos que el cliente ya recibe en su formato: no hay consumos,
 * capacidades de estanques ni proyecciones. Esas viven en el detalle interno.
 */

export type ValoresDelDia = {
  capacidad: number | null;
  ocupacion: number;
  combustible: number;
  aguaPotable: number | null;
  aguasNegras: number | null;
  basura: number;
  internet: "Sí" | "No" | "Con interrupciones";
  congelamiento: boolean;
  horometro1: number;
  horometro2: number;
  /** ¿Se cargaron los consumos en BSALE? null = no informado. */
  bsale: boolean | null;
  bidonesUsados: number | null;
  bidonesStock: number | null;
};

export type DatosHojaCliente = {
  campamento: string;
  mandante: string;
  fecha: string;
  supervisor: string;
  generado: string;
  logoSrc: string;
  hoy: ValoresDelDia;
  series: {
    ocupacion: PuntoSerie[];
    combustible: PuntoSerie[];
    aguaPotable: PuntoSerie[];
    aguasNegras: PuntoSerie[];
    basura: PuntoSerie[];
  };
  desglose: Array<{ empresa: string; habitaciones: number }>;
  servicios: string[];
  /** Con menos informes que esto no se dibujan tendencias. */
  minimoTendencia: number;
};

// ── Paleta (validada: CVD y contraste contra blanco) ──────────────────────
const C = {
  serie1: "#2a78d6", serie2: "#eb6834",
  tinta: "#0b0b0b", tinta2: "#52514e", tenue: "#898781",
  grilla: "#e1e0d9", eje: "#c3c2b7", superficie: "#fcfcfb", borde: "rgba(11,11,11,0.10)",
  marca: "#006878", acento: "#ff5a00",
};
const FUENTE = "Arial, Helvetica, sans-serif";

const fmt = (v: number | null | undefined, dec = 1) =>
  v == null ? "—" : v.toLocaleString("es-CL", { maximumFractionDigits: dec });

/** Escala limpia: 0, 1.000, 2.000… nunca 0, 873, 1.746. */
function escala(max: number, marcas = 4): { tope: number; paso: number } {
  if (max <= 0) return { tope: 1, paso: 1 };
  const bruto = max / marcas;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map(m => m * mag).find(p => p >= bruto) ?? 10 * mag;
  return { tope: Math.ceil(max / paso) * paso, paso };
}

type Serie = { nombre: string; color: string; puntos: PuntoSerie[] };

/**
 * Gráfico de tendencia. Líneas de 2 px, grilla en línea fina, la última
 * cifra rotulada al final de cada serie y nada más: la tabla de control ya
 * trae los valores del día.
 */
function Tendencia({ titulo, unidad, series, tipo = "linea", referencia, topeFijo }: {
  titulo: string; unidad: string; series: Serie[];
  tipo?: "linea" | "columnas";
  referencia?: { valor: number; etiqueta: string };
  topeFijo?: number;
}) {
  const W = 330, H = 150, izq = 34, der = 34, arr = 10, aba = 22;
  const ancho = W - izq - der, alto = H - arr - aba;
  const n = Math.max(...series.map(s => s.puntos.length), 1);
  const valores = series.flatMap(s => s.puntos.map(p => p.valor)).filter((v): v is number => v != null);
  const { tope, paso } = topeFijo != null ? { tope: topeFijo, paso: topeFijo / 4 } : escala(Math.max(...valores, referencia?.valor ?? 0, 1));
  const x = (i: number) => izq + (n === 1 ? ancho / 2 : (i * ancho) / (n - 1));
  const xc = (i: number) => izq + ((i + 0.5) * ancho) / n;
  const y = (v: number) => arr + alto - (v / tope) * alto;
  const fechas = series[0]?.puntos.map(p => p.fecha) ?? [];
  const marcasX = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const marcasY = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);

  return (
    <figure style={{ margin: 0, breakInside: "avoid" }}>
      <figcaption style={{ fontSize: 10.5, fontWeight: 700, color: C.tinta, marginBottom: 2 }}>
        {titulo} <span style={{ fontWeight: 400, color: C.tinta2 }}>({unidad})</span>
      </figcaption>
      {series.length > 1 && (
        <div style={{ display: "flex", gap: 12, fontSize: 9, color: C.tinta2, marginBottom: 2 }}>
          {series.map(s => (
            <span key={s.nombre} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 12, height: 2, background: s.color, display: "inline-block" }} />{s.nombre}
            </span>
          ))}
        </div>
      )}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={titulo} style={{ display: "block", fontFamily: FUENTE }}>
        {marcasY.map(v => (
          <g key={v}>
            <line x1={izq} x2={izq + ancho} y1={y(v)} y2={y(v)} stroke={v === 0 ? C.eje : C.grilla} strokeWidth={1} />
            <text x={izq - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill={C.tenue}>{fmt(v, 1)}</text>
          </g>
        ))}
        {marcasX.map(i => (
          <text key={i} x={tipo === "columnas" ? xc(i) : x(i)} y={H - 6} textAnchor="middle" fontSize={8} fill={C.tenue}>{fechas[i]}</text>
        ))}
        {referencia && (
          <g>
            <line x1={izq} x2={izq + ancho} y1={y(referencia.valor)} y2={y(referencia.valor)} stroke={C.tinta2} strokeWidth={1} />
            <text x={izq + ancho + 3} y={y(referencia.valor) + 3} fontSize={8} fill={C.tinta2}>{referencia.etiqueta}</text>
          </g>
        )}
        {tipo === "columnas" && series[0] && (() => {
          const banda = ancho / n, grosor = Math.min(14, banda - 2);
          return series[0].puntos.map((p, i) => {
            if (p.valor == null) return null;
            const alto_ = Math.max(0, y(0) - y(p.valor)), r = Math.min(3, alto_ / 2, grosor / 2);
            const x0 = xc(i) - grosor / 2, y0 = y(p.valor);
            // Extremo redondeado arriba, recto en la base.
            const d = `M${x0},${y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + grosor - r} Q${x0 + grosor},${y0} ${x0 + grosor},${y0 + r} V${y(0)} Z`;
            return <path key={i} d={d} fill={series[0].color}><title>{`${p.fecha}: ${fmt(p.valor)} ${unidad}`}</title></path>;
          });
        })()}
        {tipo === "linea" && series.map(s => {
          const tramos: string[] = [];
          let actual = "";
          s.puntos.forEach((p, i) => {
            if (p.valor == null) { if (actual) tramos.push(actual); actual = ""; return; }
            actual += `${actual ? "L" : "M"}${x(i)},${y(p.valor)} `;
          });
          if (actual) tramos.push(actual);
          const ultimo = [...s.puntos].map((p, i) => ({ ...p, i })).reverse().find(p => p.valor != null);
          return (
            <g key={s.nombre}>
              {series.length === 1 && tramos.map((t, k) => {
                const pts = t.trim().split(" ");
                const x1 = pts[0].slice(1).split(",")[0], x2 = pts[pts.length - 1].slice(1).split(",")[0];
                return <path key={`a${k}`} d={`${t} L${x2},${y(0)} L${x1},${y(0)} Z`} fill={s.color} opacity={0.1} />;
              })}
              {tramos.map((t, k) => <path key={k} d={t} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
              {s.puntos.map((p, i) => p.valor == null ? null : (
                <circle key={i} cx={x(i)} cy={y(p.valor)} r={6} fill="transparent"><title>{`${s.nombre} ${p.fecha}: ${fmt(p.valor)} ${unidad}`}</title></circle>
              ))}
              {ultimo && (
                <g>
                  <circle cx={x(ultimo.i)} cy={y(ultimo.valor!)} r={4} fill={s.color} stroke={C.superficie} strokeWidth={2} />
                  <text x={x(ultimo.i) + 7} y={y(ultimo.valor!) + 3} fontSize={8.5} fontWeight={700} fill={C.tinta}>{fmt(ultimo.valor)}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function Indicador({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div style={{ border: `1px solid ${C.borde}`, background: C.superficie, borderRadius: 6, padding: "8px 10px", breakInside: "avoid" }}>
      <div style={{ fontSize: 9, color: C.tinta2 }}>{etiqueta}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.tinta, marginTop: 2 }}>{valor}</div>
      {detalle && <div style={{ fontSize: 8.5, color: C.tenue, marginTop: 1 }}>{detalle}</div>}
    </div>
  );
}

export function HojaCliente(d: DatosHojaCliente) {
  const { hoy } = d;
  const disponibles = hoy.capacidad != null ? Math.max(0, hoy.capacidad - hoy.ocupacion) : null;
  const totalDesglose = d.desglose.reduce((s, f) => s + f.habitaciones, 0);
  const desgloseOrden = [...d.desglose].sort((a, b) => b.habitaciones - a.habitaciones);
  const maxDesglose = Math.max(...d.desglose.map(f => f.habitaciones), 1);

  const control: Array<[string, string]> = [
    ["Capacidad total del campamento (camas) [ref.]", fmt(hoy.capacidad)],
    ["Ocupación total del campamento (camas)", fmt(hoy.ocupacion)],
    ["Disponibilidad de camas", fmt(disponibles)],
    ["Congelamiento en redes", hoy.congelamiento ? "Sí" : "No"],
    ["Nivel de contenedor de basura", `${hoy.basura}%`],
    ["Combustible disponible (litros)", fmt(hoy.combustible)],
    ["Horómetro generador N° 1 (h)", fmt(hoy.horometro1)],
    ["Horómetro generador N° 2 (h)", fmt(hoy.horometro2)],
    ["Carga de consumos BSALE", hoy.bsale == null ? "—" : hoy.bsale ? "Sí" : "No"],
    ["Estatus Starlink / internet", hoy.internet],
    ["Bidones 20 L utilizados en el día", fmt(hoy.bidonesUsados)],
    ["Bidones 20 L en stock", fmt(hoy.bidonesStock)],
    ["Agua potable (m³)", fmt(hoy.aguaPotable)],
    ["Acumulación de aguas negras (m³)", fmt(hoy.aguasNegras)],
  ];
  const mitad = Math.ceil(control.length / 2);
  const celda: React.CSSProperties = { padding: "3px 6px", fontSize: 9.5, borderBottom: `1px solid ${C.grilla}` };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 16px 28px", fontFamily: FUENTE, color: C.tinta, background: "#fff", colorScheme: "light" }}>
      {/* Encabezado */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src={d.logoSrc} alt="Nómade" width={58} height={58} style={{ objectFit: "contain" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.marca }}>Informe diario de campamento</div>
          <div style={{ fontSize: 9, color: C.tinta2, marginTop: 2 }}>Código REG-OP-OPE-001 · Rev. 1</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: C.tinta2 }}>Fecha</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{d.fecha}</div>
        </div>
      </div>
      <div style={{ height: 3, background: C.acento, margin: "10px 0 10px" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 9.5, marginBottom: 12 }}>
        <div><span style={{ color: C.tinta2 }}>Campamento</span><br /><strong>{d.campamento}</strong></div>
        <div><span style={{ color: C.tinta2 }}>Mandante</span><br /><strong>{d.mandante}</strong></div>
        <div><span style={{ color: C.tinta2 }}>Supervisor</span><br /><strong>{d.supervisor}</strong></div>
      </div>

      {/* Indicadores del día: los mismos valores de la tabla de control */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
        <Indicador etiqueta="Ocupación" valor={`${hoy.ocupacion}${hoy.capacidad != null ? ` / ${hoy.capacidad}` : ""}`}
          detalle={disponibles != null ? `${disponibles} camas disponibles` : undefined} />
        <Indicador etiqueta="Combustible disponible" valor={`${fmt(hoy.combustible)} L`} />
        <Indicador etiqueta="Contenedor de basura" valor={`${hoy.basura}%`} />
        <Indicador etiqueta="Agua potable" valor={`${fmt(hoy.aguaPotable)} m³`} />
        <Indicador etiqueta="Aguas negras" valor={`${fmt(hoy.aguasNegras)} m³`} />
        <Indicador etiqueta="Internet · Congelamiento" valor={`${hoy.internet === "Sí" ? "Operativo" : hoy.internet} · ${hoy.congelamiento ? "Sí" : "No"}`} />
      </div>

      {/* Tendencias: solo con informes que el cliente recibió desde la plataforma */}
      {d.series.ocupacion.length < d.minimoTendencia ? (
        // Aviso para quien prepara el informe: en el PDF la sección simplemente
        // no aparece, el cliente no tiene por qué leer cómo se arma.
        <div className="no-imprimir" style={{ fontSize: 9.5, color: C.tenue, marginBottom: 14, padding: "8px 10px", border: `1px solid ${C.grilla}`, borderRadius: 6 }}>
          Los gráficos de tendencia aparecen desde el {d.minimoTendencia}.º informe emitido con este formato.
        </div>
      ) : (<>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.marca, marginBottom: 6 }}>Tendencia de los últimos {d.series.ocupacion.length} informes</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: 14 }}>
        <Tendencia titulo="Ocupación" unidad="camas" tipo="columnas"
          series={[{ nombre: "Ocupación", color: C.serie1, puntos: d.series.ocupacion }]}
          referencia={hoy.capacidad != null ? { valor: hoy.capacidad, etiqueta: `Cap. ${hoy.capacidad}` } : undefined} />
        <Tendencia titulo="Combustible disponible" unidad="litros"
          series={[{ nombre: "Combustible", color: C.serie1, puntos: d.series.combustible }]} />
        <Tendencia titulo="Estanques" unidad="m³"
          series={[
            { nombre: "Agua potable", color: C.serie1, puntos: d.series.aguaPotable },
            { nombre: "Aguas negras", color: C.serie2, puntos: d.series.aguasNegras },
          ]} />
        <Tendencia titulo="Contenedor de basura" unidad="% de llenado" topeFijo={100}
          series={[{ nombre: "Basura", color: C.serie1, puntos: d.series.basura }]} />
      </div>
      </>)}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: 20, marginBottom: 14, breakInside: "avoid" }}>
        {/* Desglose */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.marca, marginBottom: 6 }}>
            Ocupación por empresa <span style={{ fontWeight: 400, color: C.tinta2, fontSize: 9.5 }}>· {d.desglose.length ? `${totalDesglose} habitaciones` : "sin informar"}</span>
          </div>
          {desgloseOrden.length === 0 ? <div style={{ fontSize: 9.5, color: C.tenue }}>—</div> : (
            <div style={{ display: "grid", gap: 4 }}>
              {desgloseOrden.map(f => (
                <div key={f.empresa} style={{ display: "grid", gridTemplateColumns: "92px 1fr 22px", alignItems: "center", gap: 6, fontSize: 9.5 }}>
                  <span style={{ color: C.tinta2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.empresa}</span>
                  <span style={{ height: 10, display: "block" }}>
                    {f.habitaciones > 0 && (
                      <span title={`${f.empresa}: ${f.habitaciones}`} style={{ display: "block", height: 10, width: `${(f.habitaciones / maxDesglose) * 100}%`, background: C.serie1, borderRadius: "0 3px 3px 0" }} />
                    )}
                  </span>
                  <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{f.habitaciones}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Control de campamento: el registro formal */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.marca, marginBottom: 6 }}>Control de campamento</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            {[control.slice(0, mitad), control.slice(mitad)].map((col, k) => (
              <table key={k} style={{ borderCollapse: "collapse", width: "100%" }}>
                <tbody>
                  {col.map(([e, v]) => (
                    <tr key={e}>
                      <td style={{ ...celda, color: C.tinta2 }}>{e}</td>
                      <td style={{ ...celda, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </div>
      </div>

      <div style={{ breakInside: "avoid" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.marca, marginBottom: 4 }}>Servicios planificados para el día</div>
        {d.servicios.length === 0
          ? <div style={{ fontSize: 9.5, color: C.tenue }}>—</div>
          : <ul style={{ margin: 0, paddingLeft: 16, fontSize: 9.5, lineHeight: 1.5 }}>{d.servicios.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </div>

      <div style={{ marginTop: 18, paddingTop: 6, borderTop: `1px solid ${C.grilla}`, display: "flex", justifyContent: "space-between", fontSize: 8, color: C.tenue }}>
        <span>Nómade Chile · Informe generado desde Nómade Control</span>
        <span>{d.generado}</span>
      </div>
    </div>
  );
}
