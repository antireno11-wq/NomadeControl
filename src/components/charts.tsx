/**
 * Gráficos SVG mínimos sin librerías externas.
 * Renderizan en el servidor — no necesitan JS en el cliente.
 */

type Series = { label: string; value: number };

const COLORS = {
  teal: "#00a8bf",
  tealLight: "#7dd3df",
  amber: "#f59e0b",
  red: "#ef4444",
  green: "#16a34a",
  slate: "#94a3b8",
  grid: "#e2e8f0",
  text: "#475569",
};

function formatNumber(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n.toLocaleString("es-CL", { maximumFractionDigits: 1 });
}

/**
 * Gráfico de barras vertical simple, con eje Y y etiquetas X rotadas.
 */
export function BarChart({
  data,
  height = 220,
  color = COLORS.teal,
  unit = "",
  title,
}: {
  data: Series[];
  height?: number;
  color?: string;
  unit?: string;
  title?: string;
}) {
  if (data.length === 0) {
    return <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Sin datos para graficar.</div>;
  }

  const padding = { top: 20, right: 16, bottom: 56, left: 48 };
  const width = 720;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const yTicks = 4;
  const barGap = 4;
  const barW = Math.max(2, innerW / data.length - barGap);

  return (
    <div>
      {title && <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 6, fontWeight: 600 }}>{title}</div>}
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }} preserveAspectRatio="xMidYMid meet">
        {/* Grid + eje Y */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const y = padding.top + (innerH * i) / yTicks;
          const value = max - (max * i) / yTicks;
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={padding.left + innerW} y2={y} stroke={COLORS.grid} strokeWidth={1} />
              <text x={padding.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill={COLORS.text}>
                {formatNumber(value)}
              </text>
            </g>
          );
        })}

        {/* Barras */}
        {data.map((d, i) => {
          const x = padding.left + (innerW * i) / data.length + barGap / 2;
          const h = (d.value / max) * innerH;
          const y = padding.top + innerH - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} fill={color} rx={2}>
                <title>{`${d.label}: ${formatNumber(d.value)}${unit ? " " + unit : ""}`}</title>
              </rect>
              {/* Etiqueta X cada N barras (para que no se amontonen) */}
              {(data.length <= 14 || i % Math.ceil(data.length / 12) === 0) && (
                <text
                  x={x + barW / 2}
                  y={padding.top + innerH + 12}
                  textAnchor="end"
                  fontSize="9"
                  fill={COLORS.text}
                  transform={`rotate(-40 ${x + barW / 2} ${padding.top + innerH + 12})`}
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Gráfico de línea con relleno bajo la curva.
 */
export function LineChart({
  data,
  height = 220,
  color = COLORS.teal,
  unit = "",
  title,
}: {
  data: Series[];
  height?: number;
  color?: string;
  unit?: string;
  title?: string;
}) {
  if (data.length === 0) {
    return <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Sin datos para graficar.</div>;
  }

  const padding = { top: 20, right: 16, bottom: 56, left: 48 };
  const width = 720;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const yTicks = 4;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const points = data.map((d, i) => {
    const x = padding.left + stepX * i;
    const y = padding.top + innerH - (d.value / max) * innerH;
    return { x, y, value: d.value, label: d.label };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x} ${padding.top + innerH} L ${points[0].x} ${padding.top + innerH} Z`;

  return (
    <div>
      {title && <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 6, fontWeight: 600 }}>{title}</div>}
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }} preserveAspectRatio="xMidYMid meet">
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const y = padding.top + (innerH * i) / yTicks;
          const value = max - (max * i) / yTicks;
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={padding.left + innerW} y2={y} stroke={COLORS.grid} strokeWidth={1} />
              <text x={padding.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill={COLORS.text}>
                {formatNumber(value)}
              </text>
            </g>
          );
        })}

        <path d={areaD} fill={color} opacity={0.15} />
        <path d={pathD} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={2.5} fill={color}>
              <title>{`${p.label}: ${formatNumber(p.value)}${unit ? " " + unit : ""}`}</title>
            </circle>
            {(data.length <= 14 || i % Math.ceil(data.length / 12) === 0) && (
              <text
                x={p.x}
                y={padding.top + innerH + 12}
                textAnchor="end"
                fontSize="9"
                fill={COLORS.text}
                transform={`rotate(-40 ${p.x} ${padding.top + innerH + 12})`}
              >
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * Barras apiladas (ej. comidas servidas por día: desayuno + almuerzo + cena).
 */
export type StackedSeries = {
  label: string;
  segments: { key: string; value: number; color: string }[];
};

export function StackedBarChart({
  data,
  height = 220,
  legend,
  title,
}: {
  data: StackedSeries[];
  height?: number;
  legend?: { key: string; label: string; color: string }[];
  title?: string;
}) {
  if (data.length === 0) {
    return <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Sin datos para graficar.</div>;
  }

  const padding = { top: 20, right: 16, bottom: 56, left: 48 };
  const width = 720;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((d) => d.segments.reduce((s, x) => s + x.value, 0)), 1);
  const yTicks = 4;
  const barGap = 4;
  const barW = Math.max(2, innerW / data.length - barGap);

  return (
    <div>
      {title && <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 6, fontWeight: 600 }}>{title}</div>}
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }} preserveAspectRatio="xMidYMid meet">
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const y = padding.top + (innerH * i) / yTicks;
          const value = max - (max * i) / yTicks;
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={padding.left + innerW} y2={y} stroke={COLORS.grid} strokeWidth={1} />
              <text x={padding.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill={COLORS.text}>
                {formatNumber(value)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const x = padding.left + (innerW * i) / data.length + barGap / 2;
          let yCursor = padding.top + innerH;
          return (
            <g key={i}>
              {d.segments.map((seg, si) => {
                const h = (seg.value / max) * innerH;
                yCursor -= h;
                return (
                  <rect key={si} x={x} y={yCursor} width={barW} height={h} fill={seg.color}>
                    <title>{`${d.label} · ${seg.key}: ${formatNumber(seg.value)}`}</title>
                  </rect>
                );
              })}
              {(data.length <= 14 || i % Math.ceil(data.length / 12) === 0) && (
                <text
                  x={x + barW / 2}
                  y={padding.top + innerH + 12}
                  textAnchor="end"
                  fontSize="9"
                  fill={COLORS.text}
                  transform={`rotate(-40 ${x + barW / 2} ${padding.top + innerH + 12})`}
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {legend && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
          {legend.map((l) => (
            <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: "var(--muted)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color, display: "inline-block" }} />
              {l.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const ChartColors = COLORS;
