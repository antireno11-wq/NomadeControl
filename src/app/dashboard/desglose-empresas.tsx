"use client";

export type FilaEditable = { empresa: string; habitaciones: string };

/**
 * Editor del desglose de ocupación por empresa.
 *
 * Va en grilla con anchos fijos y botones de tamaño propio porque la hoja
 * global le pone `width: 100%` a todo botón: en la primera versión, con
 * flex, el ✕ se comía la fila y el campo del nombre quedaba de unos pocos
 * píxeles. El supervisor podía poner las habitaciones pero no la empresa.
 */
export function DesgloseEmpresas({
  filas,
  onChange,
}: {
  filas: FilaEditable[];
  onChange: (filas: FilaEditable[]) => void;
}) {
  const fila = "minmax(0, 1fr) 84px 44px";
  const cambiar = (i: number, campo: keyof FilaEditable, valor: string) =>
    onChange(filas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));

  return (
    <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
      {filas.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: fila, gap: 6, fontSize: "0.78rem", color: "var(--muted)" }}>
          <span>Empresa</span><span>Habitaciones</span><span />
        </div>
      )}
      {filas.map((f, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: fila, gap: 6, alignItems: "center" }}>
          <input
            name="empresaNombre" value={f.empresa} placeholder="Nombre de la empresa"
            aria-label={`Empresa ${i + 1}`}
            onChange={e => cambiar(i, "empresa", e.target.value)}
          />
          <input
            name="empresaHabitaciones" type="number" min={0} step={1} inputMode="numeric" value={f.habitaciones}
            aria-label={`Habitaciones de ${f.empresa || `la empresa ${i + 1}`}`}
            onChange={e => cambiar(i, "habitaciones", e.target.value)}
          />
          <button
            type="button" className="plano" title="Quitar esta empresa" aria-label={`Quitar ${f.empresa || `la empresa ${i + 1}`}`}
            onClick={() => onChange(filas.filter((_, j) => j !== i))}
            style={{ width: 44, padding: "10px 0", border: "1px solid var(--border)" }}
          >
            ✕
          </button>
        </div>
      ))}
      <div>
        <button
          type="button" className="plano"
          onClick={() => onChange([...filas, { empresa: "", habitaciones: "0" }])}
          style={{ width: "auto", padding: "8px 14px", border: "1px solid var(--border)", fontWeight: 600 }}
        >
          + Agregar empresa
        </button>
      </div>
    </div>
  );
}
