import React from "react";

/**
 * Gráficos del tablero de acreditación, en SVG y sin librerías.
 *
 * Aparte de `charts.tsx`, que resuelve las series temporales de operaciones:
 * acá lo que se mide son repartos y porcentajes de cumplimiento, no
 * evolución en el tiempo, y las formas no se parecen en nada.
 *
 * Se renderizan en el servidor y no traen JavaScript al cliente: un tablero
 * que se mira, no que se manipula. Cualquier librería de charts costaría más
 * kilobytes que todo el resto de la página.
 */

export type Segmento = { label: string; valor: number; color: string };

/** Dona con el total al centro. Los segmentos en cero no se dibujan. */
export function Dona({
  segmentos,
  total,
  titulo,
  subtitulo,
  size = 190,
  grosor = 26,
}: {
  segmentos: Segmento[];
  total: number;
  titulo: string;
  subtitulo?: string;
  size?: number;
  grosor?: number;
}) {
  const radio = (size - grosor) / 2;
  const centro = size / 2;
  const circunferencia = 2 * Math.PI * radio;
  const suma = segmentos.reduce((s, x) => s + x.valor, 0);

  let acumulado = 0;
  const arcos = segmentos
    .filter(s => s.valor > 0)
    .map(s => {
      const fraccion = suma === 0 ? 0 : s.valor / suma;
      const arco = {
        ...s,
        dash: `${fraccion * circunferencia} ${circunferencia}`,
        offset: -acumulado * circunferencia,
      };
      acumulado += fraccion;
      return arco;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} role="img" aria-label={titulo}>
          <circle cx={centro} cy={centro} r={radio} fill="none" stroke="#eef2f7" strokeWidth={grosor} />
          {arcos.map(a => (
            <circle
              key={a.label}
              cx={centro} cy={centro} r={radio}
              fill="none" stroke={a.color} strokeWidth={grosor}
              strokeDasharray={a.dash} strokeDashoffset={a.offset}
            />
          ))}
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", textAlign: "center",
        }}>
          <div style={{ fontSize: size > 150 ? "2rem" : "1.5rem", fontWeight: 800, lineHeight: 1, color: "var(--text)" }}>
            {total.toLocaleString("es-CL")}
          </div>
          <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 4, maxWidth: size - grosor * 2, lineHeight: 1.25 }}>
            {titulo}
          </div>
        </div>
      </div>
      {subtitulo && (
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", textAlign: "center" }}>{subtitulo}</div>
      )}
      <div style={{ display: "grid", gap: 4, width: "100%" }}>
        {segmentos.map(s => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.78rem" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: "var(--muted)", flex: 1 }}>{s.label}</span>
            <strong style={{ color: "var(--text)" }}>{s.valor.toLocaleString("es-CL")}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barras verticales. Para repartos de pocas categorías (los tramos de aging). */
export function BarrasVerticales({
  datos,
  alto = 150,
}: {
  datos: Array<{ label: string; valor: number; color: string; sub?: string }>;
  alto?: number;
}) {
  const max = Math.max(1, ...datos.map(d => d.valor));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: alto + 46 }}>
      {datos.map(d => {
        const h = Math.round((d.valor / max) * alto);
        return (
          <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 800, color: d.valor > 0 ? d.color : "var(--muted)" }}>
              {d.valor}
            </div>
            <div
              title={`${d.label}: ${d.valor}`}
              style={{
                width: "100%", maxWidth: 54,
                height: Math.max(d.valor > 0 ? 4 : 2, h),
                background: d.valor > 0 ? d.color : "#e2e8f0",
                borderRadius: "5px 5px 0 0",
              }}
            />
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", textAlign: "center", lineHeight: 1.2 }}>
              {d.label}
              {d.sub && <div style={{ fontSize: "0.62rem", opacity: 0.75 }}>{d.sub}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Barra horizontal de avance, con semáforo. */
export function BarraAvance({
  porcentaje,
  color,
  alto = 8,
}: {
  porcentaje: number;
  color: string;
  alto?: number;
}) {
  return (
    <div style={{ background: "#eef2f7", borderRadius: alto, height: alto, width: "100%", overflow: "hidden" }}>
      <div style={{
        width: `${Math.max(0, Math.min(100, porcentaje))}%`,
        height: "100%", background: color, borderRadius: alto,
      }} />
    </div>
  );
}

/** Verde sobre 90, ámbar sobre 60, rojo abajo. El mismo semáforo de la planilla. */
export function colorAvance(pct: number): string {
  if (pct >= 90) return "#16a34a";
  if (pct >= 60) return "#eab308";
  return "#dc2626";
}

export function etiquetaSemaforo(pct: number): { texto: string; bg: string; color: string } {
  if (pct >= 90) return { texto: "VERDE", bg: "#dcfce7", color: "#166534" };
  if (pct >= 60) return { texto: "AMARILLO", bg: "#fef3c7", color: "#854d0e" };
  return { texto: "ROJO", bg: "#fee2e2", color: "#991b1b" };
}

/** Barra apilada horizontal: cumplido / pendiente / vencido en una sola línea. */
export function BarraApilada({
  partes,
  alto = 20,
}: {
  partes: Array<{ valor: number; color: string; label: string }>;
  alto?: number;
}) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (total === 0) {
    return <div style={{ background: "#eef2f7", borderRadius: 4, height: alto, width: "100%" }} />;
  }
  return (
    <div style={{ display: "flex", height: alto, width: "100%", borderRadius: 4, overflow: "hidden", background: "#eef2f7" }}>
      {partes.filter(p => p.valor > 0).map(p => (
        <div
          key={p.label}
          title={`${p.label}: ${p.valor}`}
          style={{
            width: `${(p.valor / total) * 100}%`,
            background: p.color,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.65rem", fontWeight: 700, color: "white",
          }}
        >
          {(p.valor / total) > 0.09 ? p.valor : ""}
        </div>
      ))}
    </div>
  );
}
