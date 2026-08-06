import Link from "next/link";
import type { ResumenExigencia } from "@/lib/requisitos-db";

/**
 * Aviso de documentos obligatorios faltantes.
 *
 * Es lo primero que se ve en la ficha y a propósito ocupa espacio: en la
 * planilla un obligatorio faltante era una celda gris más entre cuarenta, y
 * por eso nadie lo veía hasta que el mandante rechazaba al trabajador.
 */
export function ExigenciaBanner({
  exigencia,
  editarHref,
}: {
  exigencia: ResumenExigencia;
  editarHref?: string;
}) {
  if (exigencia.sinMatriz) {
    return (
      <div style={{
        border: "2px dashed #f59e0b", background: "#fffbeb", borderRadius: 12,
        padding: "16px 20px", display: "flex", gap: 14, alignItems: "flex-start",
      }}>
        <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>⚠️</span>
        <div>
          <div style={{ fontWeight: 700, color: "#92400e", fontSize: "1rem" }}>
            Sin matriz de acreditación asignada
          </div>
          <div style={{ color: "#92400e", fontSize: "0.875rem", marginTop: 4 }}>
            Falta asignarle un proyecto y un grupo de dotación. Hasta entonces no se puede saber
            qué documentos le corresponden — no está acreditado, está sin evaluar.
            {editarHref && (
              <>
                {" "}
                <Link href={editarHref} style={{ color: "#92400e", fontWeight: 700 }}>
                  Asignar ahora →
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const bloqueantes = exigencia.vencidos.length + exigencia.faltantes.length;

  if (bloqueantes === 0) {
    return (
      <div style={{
        border: "1px solid #b6e8c8", background: "#e8f7ef", borderRadius: 12,
        padding: "12px 18px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
      }}>
        <span style={{ fontSize: "1.2rem" }}>✅</span>
        <strong style={{ color: "#146c3d" }}>
          Cumple los {exigencia.obligatorios} documentos obligatorios de su cargo
        </strong>
        {exigencia.porVencer.length > 0 && (
          <span style={{ color: "#9a6300", fontSize: "0.875rem" }}>
            · {exigencia.porVencer.length} por vencer: {exigencia.porVencer.map(d => d.nombre).join(", ")}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{
      border: "2px solid #dc2626", background: "#fef2f2", borderRadius: 12,
      padding: "18px 22px",
      boxShadow: "0 2px 12px rgba(220,38,38,0.12)",
    }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "1.75rem", lineHeight: 1 }}>⛔</span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 800, color: "#991b1b", fontSize: "1.15rem" }}>
            No puede ser habilitado: {bloqueantes} documento{bloqueantes === 1 ? "" : "s"} obligatorio{bloqueantes === 1 ? "" : "s"}{" "}
            {exigencia.vencidos.length > 0 && exigencia.faltantes.length > 0
              ? "vencido o sin cargar"
              : exigencia.vencidos.length > 0 ? "vencido" : "sin cargar"}
          </div>
          <div style={{ color: "#991b1b", fontSize: "0.85rem", marginTop: 2 }}>
            {exigencia.cumplidos} de {exigencia.obligatorios} al día ({exigencia.porcentaje}%)
          </div>
        </div>
        <div style={{
          background: "#dc2626", color: "white", borderRadius: 10,
          padding: "8px 16px", fontWeight: 800, fontSize: "1.5rem", lineHeight: 1,
        }}>
          {bloqueantes}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
        {exigencia.vencidos.map(d => (
          <span key={d.tipoId} style={{
            background: "#dc2626", color: "white", borderRadius: 6,
            padding: "4px 10px", fontSize: "0.8rem", fontWeight: 600,
          }}>
            {d.nombre} · vencido
          </span>
        ))}
        {exigencia.faltantes.map(d => (
          <span key={d.tipoId} style={{
            background: "white", color: "#991b1b", border: "1px solid #fca5a5",
            borderRadius: 6, padding: "4px 10px", fontSize: "0.8rem", fontWeight: 600,
          }}>
            {d.nombre}
          </span>
        ))}
      </div>

      {(exigencia.porVencer.length > 0 || exigencia.deseablesFaltantes.length > 0) && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #fecaca", fontSize: "0.8rem", color: "#9a6300" }}>
          {exigencia.porVencer.length > 0 && (
            <div>Por vencer: {exigencia.porVencer.map(d => d.nombre).join(", ")}</div>
          )}
          {exigencia.deseablesFaltantes.length > 0 && (
            <div style={{ color: "var(--muted)" }}>
              Deseables pendientes (no bloquean): {exigencia.deseablesFaltantes.map(d => d.nombre).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Versión de una línea para tablas: el número grande y nada más. */
export function ExigenciaChip({ exigencia }: { exigencia: ResumenExigencia }) {
  if (exigencia.sinMatriz) {
    return (
      <span
        title="Sin proyecto o cargo asignado: no se le puede calcular el avance"
        style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d", borderRadius: 6, padding: "2px 8px", fontSize: "0.75rem", fontWeight: 700, whiteSpace: "nowrap" }}
      >
        Sin matriz
      </span>
    );
  }

  const bloqueantes = exigencia.vencidos.length + exigencia.faltantes.length;
  if (bloqueantes === 0) {
    return (
      <span style={{ background: "#e8f7ef", color: "#146c3d", border: "1px solid #b6e8c8", borderRadius: 6, padding: "2px 8px", fontSize: "0.75rem", fontWeight: 700, whiteSpace: "nowrap" }}>
        ✓ {exigencia.obligatorios}/{exigencia.obligatorios}
      </span>
    );
  }

  return (
    <span
      title={[...exigencia.vencidos.map(d => `${d.nombre} (vencido)`), ...exigencia.faltantes.map(d => d.nombre)].join("\n")}
      style={{ background: "#dc2626", color: "white", borderRadius: 6, padding: "2px 8px", fontSize: "0.75rem", fontWeight: 800, whiteSpace: "nowrap" }}
    >
      ⛔ Faltan {bloqueantes}
    </span>
  );
}
