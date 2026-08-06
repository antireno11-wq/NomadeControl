"use client";

import React from "react";
import { setRequisitoAction, setRequisitoFilaAction, setCondicionFilaAction } from "./actions";
import { CATEGORIA_LABEL, type CategoriaDocumento } from "@/lib/acreditacion";
import { CONDICION_LABEL, CONDICIONES, TIPOS_SIN_REGLA_DEFINIDA, type CondicionRequisito } from "@/lib/requisitos";

type Nivel = "obligatorio" | "deseable";

export type TipoFila = {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
};

export type CargoCol = { id: string; nombre: string };

export type CeldaInicial = {
  cargoId: string;
  tipoId: string;
  nivel: Nivel;
  condicion: string | null;
};

/** Ciclo del clic: no aplica → obligatorio → deseable → no aplica. */
function siguiente(actual: Nivel | null): Nivel | null {
  if (actual === null) return "obligatorio";
  if (actual === "obligatorio") return "deseable";
  return null;
}

const ESTILO_CELDA: Record<string, React.CSSProperties> = {
  obligatorio: { background: "#dbeafe", color: "#1e40af", borderColor: "#93c5fd" },
  deseable:    { background: "#fef3c7", color: "#92400e", borderColor: "#fcd34d" },
  vacia:       { background: "transparent", color: "#cbd5e1", borderColor: "var(--border, #e2e8f0)" },
};

const SIGLA: Record<Nivel, string> = { obligatorio: "Ob", deseable: "De" };

export function RequisitosMatriz({
  proyectoId,
  tipos,
  cargos,
  iniciales,
}: {
  proyectoId: string;
  tipos: TipoFila[];
  cargos: CargoCol[];
  iniciales: CeldaInicial[];
}) {
  const clave = (cargoId: string, tipoId: string) => `${cargoId}|${tipoId}`;

  const [celdas, setCeldas] = React.useState<Map<string, Nivel>>(() => {
    const m = new Map<string, Nivel>();
    for (const c of iniciales) m.set(clave(c.cargoId, c.tipoId), c.nivel);
    return m;
  });
  const [pendiente, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  // La condición es del documento, no de la celda: el anexo de contrato se
  // exige según el estado del contrato de esa persona, y eso no depende del
  // cargo. Por eso se edita una vez por fila.
  const [condicionPorTipo, setCondicionPorTipo] = React.useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const c of iniciales) if (c.condicion) m.set(c.tipoId, c.condicion);
    return m;
  });

  function cambiarCondicion(tipoId: string, condicion: string) {
    setCondicionPorTipo(prev => {
      const m = new Map(prev);
      if (condicion) m.set(tipoId, condicion); else m.delete(tipoId);
      return m;
    });
    setError(null);
    startTransition(async () => {
      const r = await setCondicionFilaAction({ proyectoId, tipoId, condicion: condicion || null });
      if (!r.ok) setError(r.error);
    });
  }

  function cambiarCelda(cargoId: string, tipoId: string) {
    const k = clave(cargoId, tipoId);
    const nuevo = siguiente(celdas.get(k) ?? null);

    setCeldas(prev => {
      const m = new Map(prev);
      if (nuevo === null) m.delete(k); else m.set(k, nuevo);
      return m;
    });
    setError(null);

    startTransition(async () => {
      const r = await setRequisitoAction({
        proyectoId, cargoId, tipoId, nivel: nuevo,
        condicion: condicionPorTipo.get(tipoId) ?? null,
      });
      if (!r.ok) {
        setError(r.error);
        // Revertir: el servidor manda, no la vista optimista.
        setCeldas(prev => {
          const m = new Map(prev);
          const original = iniciales.find(c => c.cargoId === cargoId && c.tipoId === tipoId);
          if (original) m.set(k, original.nivel); else m.delete(k);
          return m;
        });
      }
    });
  }

  function cambiarFila(tipoId: string, nivel: Nivel | null) {
    setCeldas(prev => {
      const m = new Map(prev);
      for (const c of cargos) {
        const k = clave(c.id, tipoId);
        if (nivel === null) m.delete(k); else m.set(k, nivel);
      }
      return m;
    });
    setError(null);
    startTransition(async () => {
      const r = await setRequisitoFilaAction({ proyectoId, tipoId, nivel });
      if (!r.ok) setError(r.error);
    });
  }

  // Agrupamos por categoría para que 44 filas se puedan leer.
  const grupos: Array<{ categoria: string; filas: TipoFila[] }> = [];
  for (const t of tipos) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.categoria === t.categoria) ultimo.filas.push(t);
    else grupos.push({ categoria: t.categoria, filas: [t] });
  }

  const sinDefinir = tipos.filter(
    t => TIPOS_SIN_REGLA_DEFINIDA.includes(t.codigo) &&
         cargos.every(c => !celdas.has(clave(c.id, t.id))),
  );

  const totalObligatorios = [...celdas.values()].filter(n => n === "obligatorio").length;

  const thBase: React.CSSProperties = {
    position: "sticky", top: 0, zIndex: 2, background: "var(--card, #fff)",
    borderBottom: "2px solid var(--border, #e2e8f0)", padding: "0.5rem 0.35rem",
    fontSize: "0.7rem", fontWeight: 600, textAlign: "center", whiteSpace: "normal",
    minWidth: 74, maxWidth: 74,
  };

  return (
    <div>
      {sinDefinir.length > 0 && (
        <div className="alert" style={{ background: "#fffbeb", borderColor: "#fcd34d", color: "#92400e", marginBottom: "1rem" }}>
          <strong>{sinDefinir.length} documento{sinDefinir.length === 1 ? "" : "s"} sin regla definida.</strong>{" "}
          La planilla del mandante los marcaba como «según cargo» sin decir cuál, así que no se
          sembraron: adivinarlos sería inventar una exigencia contractual. Defínelos en la grilla —
          quedan marcados en ámbar.
          <div style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}>
            {sinDefinir.map(t => t.nombre).join(" · ")}
          </div>
        </div>
      )}

      {error && <div className="alert error" style={{ marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "flex", gap: "1.25rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>
        <span><span style={{ ...ESTILO_CELDA.obligatorio, border: "1px solid", borderRadius: 4, padding: "0.1rem 0.4rem", fontWeight: 700, fontSize: "0.7rem" }}>Ob</span> Obligatorio — bloquea la habilitación</span>
        <span><span style={{ ...ESTILO_CELDA.deseable, border: "1px solid", borderRadius: 4, padding: "0.1rem 0.4rem", fontWeight: 700, fontSize: "0.7rem" }}>De</span> Deseable — solo informa</span>
        <span><span style={{ ...ESTILO_CELDA.vacia, border: "1px solid", borderRadius: 4, padding: "0.1rem 0.4rem", fontWeight: 700, fontSize: "0.7rem" }}>—</span> No aplica</span>
        <span style={{ marginLeft: "auto" }}>
          {totalObligatorios} obligatorios definidos{pendiente ? " · guardando…" : ""}
        </span>
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, maxHeight: "70vh", overflowY: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th style={{ ...thBase, position: "sticky", left: 0, zIndex: 3, textAlign: "left", minWidth: 280, maxWidth: 280 }}>
                Documento
              </th>
              <th style={{ ...thBase, minWidth: 96, maxWidth: 96 }}>Toda la fila</th>
              {cargos.map(c => (
                <th key={c.id} style={thBase} title={c.nombre}>{c.nombre}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grupos.map(g => (
              <React.Fragment key={g.categoria}>
                <tr>
                  <td
                    colSpan={cargos.length + 2}
                    style={{
                      background: "var(--surface, #f8fafc)", padding: "0.35rem 0.6rem",
                      fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
                      letterSpacing: "0.04em", color: "var(--muted)",
                      position: "sticky", left: 0,
                    }}
                  >
                    {CATEGORIA_LABEL[g.categoria as CategoriaDocumento] ?? g.categoria}
                  </td>
                </tr>
                {g.filas.map(t => {
                  const cond = condicionPorTipo.get(t.id);
                  const indefinido = TIPOS_SIN_REGLA_DEFINIDA.includes(t.codigo) &&
                    cargos.every(c => !celdas.has(clave(c.id, t.id)));
                  return (
                    <tr key={t.id} style={indefinido ? { background: "#fffbeb" } : undefined}>
                      <td style={{
                        position: "sticky", left: 0, zIndex: 1,
                        background: indefinido ? "#fffbeb" : "var(--card, #fff)",
                        borderBottom: "1px solid var(--border, #e2e8f0)",
                        borderRight: "1px solid var(--border, #e2e8f0)",
                        padding: "0.4rem 0.6rem", minWidth: 280, maxWidth: 280,
                      }}>
                        <div style={{ fontWeight: 500 }}>{t.nombre}</div>
                        {/* La condición es del documento, no de la celda: se aplica a
                            todos los cargos de la fila. */}
                        <select
                          value={cond ?? ""}
                          onChange={e => cambiarCondicion(t.id, e.target.value)}
                          title="Condición del trabajador que activa este requisito"
                          style={{
                            marginTop: 3, padding: "1px 4px", fontSize: "0.68rem",
                            maxWidth: "100%", color: cond ? "#0369a1" : "var(--muted)",
                            border: cond ? "1px solid #7dd3fc" : "1px solid transparent",
                            background: cond ? "#f0f9ff" : "transparent",
                            borderRadius: 4,
                          }}
                        >
                          <option value="">Se exige siempre</option>
                          {CONDICIONES.map(c => (
                            <option key={c} value={c}>{CONDICION_LABEL[c]}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border, #e2e8f0)", padding: "0.25rem", textAlign: "center", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => cambiarFila(t.id, "obligatorio")}
                          title="Marcar obligatorio para todos los cargos"
                          style={{ ...ESTILO_CELDA.obligatorio, border: "1px solid", borderRadius: 4, padding: "0.15rem 0.35rem", fontSize: "0.65rem", fontWeight: 700, cursor: "pointer", marginRight: 3 }}
                        >Ob</button>
                        <button
                          type="button"
                          onClick={() => cambiarFila(t.id, null)}
                          title="Quitar de todos los cargos"
                          style={{ ...ESTILO_CELDA.vacia, border: "1px solid", borderRadius: 4, padding: "0.15rem 0.35rem", fontSize: "0.65rem", fontWeight: 700, cursor: "pointer" }}
                        >—</button>
                      </td>
                      {cargos.map(c => {
                        const nivel = celdas.get(clave(c.id, t.id)) ?? null;
                        const est = nivel ? ESTILO_CELDA[nivel] : ESTILO_CELDA.vacia;
                        return (
                          <td key={c.id} style={{ borderBottom: "1px solid var(--border, #e2e8f0)", padding: 3, textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => cambiarCelda(c.id, t.id)}
                              title={`${t.nombre} · ${c.nombre}`}
                              style={{
                                ...est, border: "1px solid", borderRadius: 5,
                                width: "100%", minWidth: 44, padding: "0.3rem 0",
                                fontSize: "0.68rem", fontWeight: 700, cursor: "pointer",
                              }}
                            >
                              {nivel ? SIGLA[nivel] : "—"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.75rem" }}>
        Cada clic guarda al instante. Un documento sin marca no se le exige a ese cargo y deja
        de contar en su porcentaje de avance — no hace falta escribir «N/A» como en la planilla.
      </p>
    </div>
  );
}
