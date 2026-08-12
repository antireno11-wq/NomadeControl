"use client";

import React from "react";
import { guardarPropuestaAction } from "../actions";
import type { PropuestaMinuta } from "@/lib/minuta-extractor";

type Abierto = { id: string; accion: string; responsable: string; vence: string };

/**
 * Revisión de la propuesta antes de publicar.
 *
 * Nada de lo que se ve acá está escrito todavía. Todo es editable y todo es
 * borrable, porque el sistema propone y la persona decide — si el usuario no
 * puede corregir en pantalla, termina corrigiendo en la base de datos.
 */
export function RevisionMinuta({
  reunionId,
  inicial,
  categorias,
  abiertos,
  puedePublicar,
}: {
  reunionId: string;
  inicial: PropuestaMinuta;
  categorias: string[];
  abiertos: Abierto[];
  puedePublicar: boolean;
}) {
  const [p, setP] = React.useState<PropuestaMinuta>(inicial);
  const [guardando, startTransition] = React.useTransition();
  const [guardado, setGuardado] = React.useState<string | null>(null);

  function actualizar(nueva: PropuestaMinuta) {
    setP(nueva);
    setGuardado(null);
  }

  function guardar() {
    startTransition(async () => {
      const r = await guardarPropuestaAction(reunionId, p);
      setGuardado(r.ok ? "Cambios guardados." : r.error ?? "No se pudo guardar.");
    });
  }

  const nombreAbierto = (id: string) => abiertos.find(a => a.id === id);

  const campo: React.CSSProperties = { padding: "4px 7px", fontSize: "0.82rem", width: "100%", boxSizing: "border-box" };
  const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700 };

  return (
    <div className="page-stack">
      {/* ── Resumen ─────────────────────────────────────────────────── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Resumen</h3>
        <textarea
          value={p.resumen}
          onChange={e => actualizar({ ...p, resumen: e.target.value })}
          rows={4}
          style={{ width: "100%", fontFamily: "inherit", fontSize: "0.88rem" }}
        />
      </div>

      {/* ── Cierres detectados ──────────────────────────────────────── */}
      {p.cierres.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid #16a34a" }}>
          <h3 style={{ marginTop: 0 }}>Compromisos que se detectaron cerrados ({p.cierres.length})</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.82rem", margin: "0 0 10px" }}>
            Se cierran al publicar. Quita el que no corresponda.
          </p>
          {p.cierres.map((c, i) => {
            const ab = nombreAbierto(c.id);
            return (
              <div key={c.id + i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: i ? "1px solid #f1f5f9" : undefined }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>{ab?.accion ?? c.id}</div>
                  <div style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
                    {ab?.responsable} · evidencia: «{c.evidencia}»
                  </div>
                </div>
                <button type="button" className="secondary" style={{ fontSize: "0.74rem", padding: "3px 10px" }}
                        onClick={() => actualizar({ ...p, cierres: p.cierres.filter((_, j) => j !== i) })}>
                  No cerrar
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Cierres dudosos ─────────────────────────────────────────── */}
      {p.cierres_dudosos.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid #f59e0b" }}>
          <h3 style={{ marginTop: 0 }}>Cierres dudosos ({p.cierres_dudosos.length})</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.82rem", margin: "0 0 10px" }}>
            La transcripción no fue clara. <strong>No se cierran</strong> salvo que lo confirmes acá.
          </p>
          {p.cierres_dudosos.map((c, i) => {
            const ab = nombreAbierto(c.id);
            return (
              <div key={c.id + i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: i ? "1px solid #f1f5f9" : undefined }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>{ab?.accion ?? c.id}</div>
                  <div style={{ color: "var(--muted)", fontSize: "0.76rem" }}>{c.razon} · «{c.evidencia}»</div>
                </div>
                <button type="button" style={{ fontSize: "0.74rem", padding: "3px 10px", background: "#16a34a", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
                        onClick={() => actualizar({
                          ...p,
                          cierres: [...p.cierres, { id: c.id, fecha_cierre_real: null, evidencia: c.evidencia }],
                          cierres_dudosos: p.cierres_dudosos.filter((_, j) => j !== i),
                        })}>
                  Sí, cerrarlo
                </button>
                <button type="button" className="secondary" style={{ fontSize: "0.74rem", padding: "3px 10px" }}
                        onClick={() => actualizar({ ...p, cierres_dudosos: p.cierres_dudosos.filter((_, j) => j !== i) })}>
                  Descartar
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Reprogramaciones ────────────────────────────────────────── */}
      {p.reprogramaciones.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid #2563eb" }}>
          <h3 style={{ marginTop: 0 }}>Reprogramaciones ({p.reprogramaciones.length})</h3>
          {p.reprogramaciones.map((r, i) => {
            const ab = nombreAbierto(r.id);
            return (
              <div key={r.id + i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: i ? "1px solid #f1f5f9" : undefined, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>{ab?.accion ?? r.id}</div>
                  <div style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
                    vencía {ab?.vence} · {r.motivo}
                  </div>
                </div>
                <input type="date" value={r.fecha_nueva ?? ""} style={{ ...campo, width: 150 }}
                       onChange={e => actualizar({ ...p, reprogramaciones: p.reprogramaciones.map((x, j) => j === i ? { ...x, fecha_nueva: e.target.value } : x) })} />
                <button type="button" className="secondary" style={{ fontSize: "0.74rem", padding: "3px 10px" }}
                        onClick={() => actualizar({ ...p, reprogramaciones: p.reprogramaciones.filter((_, j) => j !== i) })}>
                  Quitar
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Compromisos nuevos ──────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px 8px" }}>
          <h3 style={{ margin: 0 }}>Compromisos nuevos ({p.compromisos_nuevos.length})</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: "4px 0 0" }}>
            El punto ámbar marca lo que el extractor no leyó con claridad. Pasa el mouse por la fila
            para ver la cita de la transcripción que respalda cada dato.
          </p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={{ ...th, minWidth: 260 }}>Acción</th>
                <th style={{ ...th, minWidth: 150 }}>Responsable</th>
                <th style={{ ...th, minWidth: 140 }}>Categoría</th>
                <th style={{ ...th, minWidth: 130 }}>Cierre</th>
                <th style={{ ...th, minWidth: 160 }}>Observación</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {p.compromisos_nuevos.map((c, i) => (
                <tr key={i} title={c.evidencia ? `Evidencia: «${c.evidencia}»` : undefined}
                    style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "5px 8px" }}>
                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      {c.requiere_verificacion && <span style={{ color: "#f59e0b", flexShrink: 0 }} title="Verifica este registro">●</span>}
                      <input value={c.accion} style={campo}
                             onChange={e => actualizar({ ...p, compromisos_nuevos: p.compromisos_nuevos.map((x, j) => j === i ? { ...x, accion: e.target.value } : x) })} />
                    </div>
                  </td>
                  <td style={{ padding: "5px 8px" }}>
                    <input value={c.responsable} style={campo}
                           onChange={e => actualizar({ ...p, compromisos_nuevos: p.compromisos_nuevos.map((x, j) => j === i ? { ...x, responsable: e.target.value } : x) })} />
                  </td>
                  <td style={{ padding: "5px 8px" }}>
                    <select value={c.oportunidad} style={campo}
                            onChange={e => actualizar({ ...p, compromisos_nuevos: p.compromisos_nuevos.map((x, j) => j === i ? { ...x, oportunidad: e.target.value } : x) })}>
                      {!categorias.includes(c.oportunidad) && <option value={c.oportunidad}>{c.oportunidad}</option>}
                      {categorias.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "5px 8px" }}>
                    <input type="date" value={c.fecha_cierre ?? ""} style={campo}
                           onChange={e => actualizar({ ...p, compromisos_nuevos: p.compromisos_nuevos.map((x, j) => j === i ? { ...x, fecha_cierre: e.target.value } : x) })} />
                  </td>
                  <td style={{ padding: "5px 8px" }}>
                    <input value={c.observacion ?? ""} style={campo}
                           onChange={e => actualizar({ ...p, compromisos_nuevos: p.compromisos_nuevos.map((x, j) => j === i ? { ...x, observacion: e.target.value } : x) })} />
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right" }}>
                    <button type="button" title="Quitar" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)" }}
                            onClick={() => actualizar({ ...p, compromisos_nuevos: p.compromisos_nuevos.filter((_, j) => j !== i) })}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 18px" }}>
          <button type="button" className="secondary" style={{ fontSize: "0.8rem" }}
                  onClick={() => actualizar({ ...p, compromisos_nuevos: [...p.compromisos_nuevos, {
                    oportunidad: "Otro", accion: "", responsable: "", contrato: null,
                    fecha_cierre: null, observacion: "", requiere_verificacion: false, evidencia: "Agregado a mano",
                  }] })}>
            + Agregar compromiso
          </button>
        </div>
      </div>

      {/* ── Amenazas ────────────────────────────────────────────────── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Amenazas ({p.amenazas_nuevas.length})</h3>
        {p.amenazas_nuevas.map((a, i) => (
          <div key={i} title={a.evidencia ? `Evidencia: «${a.evidencia}»` : undefined}
               style={{ display: "grid", gridTemplateColumns: "1fr 150px 140px 130px auto", gap: 8, alignItems: "center", padding: "6px 0", borderTop: i ? "1px solid #f1f5f9" : undefined }}>
            <input value={a.descripcion} style={campo}
                   onChange={e => actualizar({ ...p, amenazas_nuevas: p.amenazas_nuevas.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x) })} />
            <input value={a.responsable} placeholder="Responsable" style={campo}
                   onChange={e => actualizar({ ...p, amenazas_nuevas: p.amenazas_nuevas.map((x, j) => j === i ? { ...x, responsable: e.target.value } : x) })} />
            <input value={a.area} placeholder="Área" style={campo}
                   onChange={e => actualizar({ ...p, amenazas_nuevas: p.amenazas_nuevas.map((x, j) => j === i ? { ...x, area: e.target.value } : x) })} />
            <input type="date" value={a.fecha_cierre ?? ""} style={campo}
                   onChange={e => actualizar({ ...p, amenazas_nuevas: p.amenazas_nuevas.map((x, j) => j === i ? { ...x, fecha_cierre: e.target.value } : x) })} />
            <button type="button" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)" }}
                    onClick={() => actualizar({ ...p, amenazas_nuevas: p.amenazas_nuevas.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
      </div>

      {/* ── RdP ─────────────────────────────────────────────────────── */}
      {p.rdp_nuevos.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Resolución de problemas ({p.rdp_nuevos.length})</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: "0 0 10px" }}>
            Un RdP no se cierra cuando se toma la acción, sino cuando se verifica que el problema
            no volvió a ocurrir.
          </p>
          {p.rdp_nuevos.map((r, i) => (
            <div key={i} title={r.evidencia ? `Evidencia: «${r.evidencia}»` : undefined}
                 style={{ display: "grid", gap: 6, padding: "8px 0", borderTop: i ? "1px solid #f1f5f9" : undefined }}>
              <input value={r.problema} placeholder="Problema" style={{ ...campo, fontWeight: 600 }}
                     onChange={e => actualizar({ ...p, rdp_nuevos: p.rdp_nuevos.map((x, j) => j === i ? { ...x, problema: e.target.value } : x) })} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <input value={r.causa_raiz ?? ""} placeholder="Causa raíz (vacía si no se identificó)" style={campo}
                       onChange={e => actualizar({ ...p, rdp_nuevos: p.rdp_nuevos.map((x, j) => j === i ? { ...x, causa_raiz: e.target.value } : x) })} />
                <input value={r.accion_correctiva ?? ""} placeholder="Acción correctiva" style={campo}
                       onChange={e => actualizar({ ...p, rdp_nuevos: p.rdp_nuevos.map((x, j) => j === i ? { ...x, accion_correctiva: e.target.value } : x) })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 150px auto", gap: 6 }}>
                <input value={r.lider} placeholder="Líder" style={campo}
                       onChange={e => actualizar({ ...p, rdp_nuevos: p.rdp_nuevos.map((x, j) => j === i ? { ...x, lider: e.target.value } : x) })} />
                <input type="date" value={r.fecha_cierre ?? ""} style={campo}
                       onChange={e => actualizar({ ...p, rdp_nuevos: p.rdp_nuevos.map((x, j) => j === i ? { ...x, fecha_cierre: e.target.value } : x) })} />
                <button type="button" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)" }}
                        onClick={() => actualizar({ ...p, rdp_nuevos: p.rdp_nuevos.filter((_, j) => j !== i) })}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Fuera de alcance ────────────────────────────────────────── */}
      {p.fuera_de_alcance.length > 0 && (
        <div className="card" style={{ background: "var(--surface, #f8fafc)" }}>
          <h3 style={{ marginTop: 0, fontSize: "0.95rem" }}>Fuera del alcance del daily</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: "0 0 8px" }}>
            Temas que salieron pero no son de la coordinación diaria. No se guardan.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.84rem" }}>
            {p.fuera_de_alcance.map((f, i) => (
              <li key={i}>{f.tema} <span style={{ color: "var(--muted)" }}>→ {f.instancia_sugerida}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Guardar y publicar ──────────────────────────────────────── */}
      <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="secondary" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar cambios"}
        </button>
        {guardado && <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{guardado}</span>}
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.8rem" }}>
          {puedePublicar
            ? "Guarda antes de publicar: se publica lo que está guardado."
            : "Publicar la minuta es del Administrador."}
        </span>
      </div>
    </div>
  );
}
