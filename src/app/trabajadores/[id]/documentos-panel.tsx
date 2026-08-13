"use client";

import React from "react";
import Link from "next/link";
import { ESTADO_STYLE, type EstadoDocumento } from "@/lib/acreditacion";
import {
  corregirDocumentoAction, anularDocumentoAction, registrarDocumentoAction,
} from "./documentos/actions";

export type VersionDoc = {
  id: string;
  fechaEmision: string | null;
  fechaVencimiento: string | null;
  sinVencimiento: boolean;
  vencimientoCalculado: boolean;
  origen: string;
  confianza: string | null;
  archivoId: string | null;
  archivosExtra: string[];
  nombreArchivo: string | null;
  nota: string | null;
  creado: string;
  confirmadoPor: string | null;
  anulado: boolean;
  anuladoPor: string | null;
  motivoAnulacion: string | null;
};

export type FilaDoc = {
  tipoId: string;
  tipoNombre: string;
  estado: EstadoDocumento;
  dias: number | null;
  /** El vigente. null cuando el tipo está sin cargar. */
  actual: VersionDoc | null;
  /** Anuladas y reemplazadas, de la más nueva a la más vieja. */
  historial: VersionDoc[];
};

const fmt = (iso: string | null) => {
  if (!iso) return null;
  const [a, m, d] = iso.split("-");
  return `${d}-${m}-${a}`;
};

const ORIGEN_LABEL: Record<string, string> = {
  extraido: "Leído con IA",
  migracion: "Migrado de la ficha anterior",
  excel: "Cargado por Excel",
  manual: "Cargado a mano",
};

/**
 * Lista de documentos con panel de detalle.
 *
 * La fila entera abre el panel y no solo el enlace del archivo: cuando algo
 * está mal, lo primero que se quiere es ver el documento al lado del dato que
 * el sistema leyó, y eso no cabe en una fila.
 */
export function DocumentosPanel({
  workerId,
  filas,
  variante,
}: {
  workerId: string;
  filas: FilaDoc[];
  variante: "compacta" | "detallada";
}) {
  const [abiertoId, setAbiertoId] = React.useState<string | null>(null);
  const fila = filas.find(f => f.tipoId === abiertoId) ?? null;

  // Cerrar con Escape: el panel tapa la ficha y quedarse encerrado en él
  // obliga a apuntarle a una X chica.
  React.useEffect(() => {
    if (!abiertoId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAbiertoId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abiertoId]);

  return (
    <>
      <div style={{ display: "grid", gap: variante === "compacta" ? 6 : 10 }}>
        {filas.map(f => {
          const style = ESTADO_STYLE[f.estado];
          const grande = variante === "detallada";
          return (
            <button
              key={f.tipoId}
              type="button"
              onClick={() => setAbiertoId(f.tipoId)}
              title="Abrir para revisar o corregir"
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                gap: 10, flexWrap: "wrap", textAlign: "left",
                padding: grande ? "14px 16px" : "8px 12px",
                borderRadius: grande ? 12 : 8,
                background: style.bg, color: style.color,
                border: `1px solid ${style.border}`,
                borderStyle: f.actual?.vencimientoCalculado ? "dashed" : "solid",
                cursor: "pointer", width: "100%", fontWeight: 400,
              }}
            >
              <span style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0, flex: 1 }}>
                <span style={{ fontWeight: grande ? 700 : 600, fontSize: grande ? "0.95rem" : "0.86rem" }}>
                  {f.tipoNombre}
                </span>
                {f.actual?.archivoId && <span style={{ fontSize: "0.72rem", opacity: 0.8 }}>📎</span>}
                {f.historial.length > 0 && (
                  <span style={{ fontSize: "0.68rem", opacity: 0.7 }}>
                    {f.historial.length + 1} versiones
                  </span>
                )}
              </span>
              <span style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontSize: "0.82rem" }}>
                  {f.estado === "sin_vencimiento" ? "∞ No vence"
                    : fmt(f.actual?.fechaVencimiento ?? null) ?? "—"}
                </span>
                <span style={{
                  padding: "2px 10px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 700,
                  background: `${style.color}22`, whiteSpace: "nowrap",
                }}>
                  {f.dias != null
                    ? (f.dias < 0 ? `${Math.abs(f.dias)}d vencido` : f.dias === 0 ? "Vence hoy" : `${f.dias}d`)
                    : style.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {fila && <Detalle workerId={workerId} fila={fila} onCerrar={() => setAbiertoId(null)} />}
    </>
  );
}

function Detalle({
  workerId, fila, onCerrar,
}: {
  workerId: string; fila: FilaDoc; onCerrar: () => void;
}) {
  const style = ESTADO_STYLE[fila.estado];
  const doc = fila.actual;
  const [anulando, setAnulando] = React.useState(false);
  const [verHistorial, setVerHistorial] = React.useState(false);

  const campo: React.CSSProperties = {
    padding: "6px 8px", fontSize: "0.85rem", width: "100%", boxSizing: "border-box",
  };
  const etiqueta: React.CSSProperties = {
    fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.03em", display: "block", marginBottom: 3,
  };

  return (
    <div
      onClick={onCerrar}
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(8,50,58,0.45)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "4vh 16px", overflowY: "auto",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--surface)", borderRadius: 14, width: "100%", maxWidth: 760,
          boxShadow: "0 20px 50px rgba(8,50,58,0.3)", overflow: "hidden",
        }}
      >
        {/* ── Cabecera ─────────────────────────────────────────────────── */}
        <div style={{
          padding: "16px 20px", background: style.bg, borderBottom: `1px solid ${style.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: "1.05rem", color: style.color }}>{fila.tipoNombre}</h3>
            <div style={{ fontSize: "0.78rem", color: style.color, opacity: 0.85, marginTop: 2 }}>
              {style.label}
              {fila.dias != null && fila.dias < 0 && ` · ${Math.abs(fila.dias)} días vencido`}
              {fila.dias != null && fila.dias >= 0 && ` · quedan ${fila.dias} días`}
            </div>
          </div>
          <button type="button" className="plano" onClick={onCerrar}
                  style={{ width: "auto", padding: "4px 10px", fontSize: "1.1rem", lineHeight: 1 }}>
            ✕
          </button>
        </div>

        <div style={{ padding: 20, display: "grid", gap: 18 }}>

          {!doc ? (
            /* ── Tipo sin cargar ──────────────────────────────────────── */
            <>
              <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
                Este documento todavía no está en el sistema. Lo normal es subir el archivo y
                dejar que se lea solo; registrar solo las fechas sirve cuando el papel existe
                pero todavía no lo tienes escaneado.
              </p>
              <Link href="/trabajadores/control-documental/extraer">
                <button type="button" style={{ width: "auto", padding: "8px 14px", fontSize: "0.85rem" }}>
                  Subir el archivo y leerlo
                </button>
              </Link>

              <form action={registrarDocumentoAction} style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="workerId" value={workerId} />
                <input type="hidden" name="tipoId" value={fila.tipoId} />
                <strong style={{ fontSize: "0.85rem" }}>O registra solo las fechas, sin archivo</strong>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={etiqueta}>Fecha de emisión</label>
                    <input type="date" name="fechaEmision" style={campo} />
                  </div>
                  <div>
                    <label style={etiqueta}>Fecha de vencimiento</label>
                    <input type="date" name="fechaVencimiento" style={campo} />
                  </div>
                </div>
                <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: "0.85rem", fontWeight: 400 }}>
                  <input type="checkbox" name="sinVencimiento" style={{ width: "auto", margin: 0 }} />
                  Este documento no vence
                </label>
                <div>
                  <label style={etiqueta}>Nota</label>
                  <input name="nota" style={campo} placeholder="Por qué se registra sin archivo" />
                </div>
                <div>
                  <button type="submit" style={{ width: "auto", padding: "8px 14px", fontSize: "0.85rem" }}>
                    Registrar sin archivo
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              {/* ── Datos leídos ───────────────────────────────────────── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                <div>
                  <span style={etiqueta}>Emisión</span>
                  <span style={{ fontSize: "0.9rem" }}>{fmt(doc.fechaEmision) ?? "—"}</span>
                </div>
                <div>
                  <span style={etiqueta}>Vencimiento</span>
                  <span style={{ fontSize: "0.9rem" }}>
                    {doc.sinVencimiento ? "No vence" : fmt(doc.fechaVencimiento) ?? "—"}
                  </span>
                  {doc.vencimientoCalculado && (
                    <span style={{ display: "block", fontSize: "0.72rem", color: "#9a6300", marginTop: 2 }}>
                      calculada, no venía impresa
                    </span>
                  )}
                </div>
                <div>
                  <span style={etiqueta}>Origen</span>
                  <span style={{ fontSize: "0.9rem" }}>
                    {ORIGEN_LABEL[doc.origen] ?? doc.origen}
                    {doc.confianza && ` · confianza ${doc.confianza}`}
                  </span>
                </div>
                <div>
                  <span style={etiqueta}>Cargado</span>
                  <span style={{ fontSize: "0.9rem" }}>{doc.creado}</span>
                  {doc.confirmadoPor && (
                    <span style={{ display: "block", fontSize: "0.72rem", color: "var(--muted)" }}>
                      por {doc.confirmadoPor}
                    </span>
                  )}
                </div>
              </div>

              {doc.nota && (
                <div style={{ fontSize: "0.85rem", padding: "8px 12px", background: "var(--bg)", borderRadius: 8 }}>
                  {doc.nota}
                </div>
              )}

              {/* ── El documento ───────────────────────────────────────── */}
              {doc.archivoId ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={etiqueta}>{doc.nombreArchivo ?? "Documento"}</span>
                    <a href={`/api/archivo/${doc.archivoId}`} target="_blank" rel="noreferrer"
                       style={{ fontSize: "0.78rem" }}>
                      Abrir en otra pestaña ↗
                    </a>
                  </div>
                  <iframe
                    src={`/api/archivo/${doc.archivoId}`}
                    title={fila.tipoNombre}
                    style={{ width: "100%", height: 380, border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }}
                  />
                  {doc.archivosExtra.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: "0.78rem", display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--muted)" }}>Otras hojas o el reverso:</span>
                      {doc.archivosExtra.map((a, i) => (
                        <a key={a} href={`/api/archivo/${a}`} target="_blank" rel="noreferrer">
                          hoja {i + 2} ↗
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: "0.85rem", padding: "10px 12px", background: "#fff4dc", borderRadius: 8, color: "#9a6300" }}>
                  Registrado sin archivo adjunto. El mandante puede pedir el respaldo.
                </div>
              )}

              {/* ── Corregir ───────────────────────────────────────────── */}
              <form action={corregirDocumentoAction} style={{ display: "grid", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                <input type="hidden" name="workerId" value={workerId} />
                <input type="hidden" name="docId" value={doc.id} />
                <strong style={{ fontSize: "0.9rem" }}>Corregir las fechas</strong>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
                  No se pisa lo anterior: se guarda una versión nueva y la actual queda en el
                  historial. El archivo se mantiene.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={etiqueta}>Fecha de emisión</label>
                    <input type="date" name="fechaEmision" defaultValue={doc.fechaEmision ?? ""} style={campo} />
                  </div>
                  <div>
                    <label style={etiqueta}>Fecha de vencimiento</label>
                    <input type="date" name="fechaVencimiento" defaultValue={doc.fechaVencimiento ?? ""} style={campo} />
                  </div>
                </div>
                <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: "0.85rem", fontWeight: 400 }}>
                  <input type="checkbox" name="sinVencimiento" defaultChecked={doc.sinVencimiento} style={{ width: "auto", margin: 0 }} />
                  Este documento no vence
                </label>
                <div>
                  <label style={etiqueta}>Nota</label>
                  <input name="nota" defaultValue={doc.nota ?? ""} style={campo} placeholder="Qué estaba mal" />
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="submit" style={{ width: "auto", padding: "8px 14px", fontSize: "0.85rem" }}>
                    Guardar corrección
                  </button>
                  <button type="button" className="plano" onClick={() => setAnulando(v => !v)}
                          style={{ width: "auto", padding: "8px 14px", fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: 8 }}>
                    Anular este documento
                  </button>
                </div>
              </form>

              {/* ── Anular ─────────────────────────────────────────────── */}
              {anulando && (
                <form action={anularDocumentoAction} style={{ display: "grid", gap: 8, padding: "12px 14px", background: "#fce9e8", borderRadius: 10 }}>
                  <input type="hidden" name="workerId" value={workerId} />
                  <input type="hidden" name="docId" value={doc.id} />
                  <strong style={{ fontSize: "0.85rem", color: "#9e2f23" }}>Anular sin reemplazar</strong>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#9e2f23" }}>
                    El tipo vuelve a quedar sin cargar. Úsalo cuando el documento no era de esta
                    persona o no correspondía. Queda en el historial, no se borra.
                  </p>
                  <input name="motivo" required minLength={4} style={campo} placeholder="Motivo — queda registrado" />
                  <div>
                    <button type="submit" className="danger" style={{ width: "auto", padding: "7px 14px", fontSize: "0.85rem" }}>
                      Anular
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {/* ── Historial ────────────────────────────────────────────── */}
          {fila.historial.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <button type="button" className="plano" onClick={() => setVerHistorial(v => !v)}
                      style={{ width: "auto", padding: 0, fontSize: "0.85rem", textDecoration: "underline" }}>
                {verHistorial ? "Ocultar" : "Ver"} las {fila.historial.length} versiones anteriores
              </button>
              {verHistorial && (
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  {fila.historial.map(v => (
                    <div key={v.id} style={{
                      fontSize: "0.8rem", padding: "8px 12px", borderRadius: 8,
                      background: "var(--bg)", color: "var(--muted)",
                    }}>
                      <div>
                        <strong>{v.sinVencimiento ? "No vence" : fmt(v.fechaVencimiento) ?? "sin fecha"}</strong>
                        {v.fechaEmision && ` · emitido ${fmt(v.fechaEmision)}`}
                        {" · "}{ORIGEN_LABEL[v.origen] ?? v.origen}
                      </div>
                      <div style={{ marginTop: 2 }}>
                        Cargado {v.creado}
                        {v.anulado && v.anuladoPor && ` · anulado por ${v.anuladoPor}`}
                        {v.motivoAnulacion && `: ${v.motivoAnulacion}`}
                      </div>
                      {v.archivoId && (
                        <a href={`/api/archivo/${v.archivoId}`} target="_blank" rel="noreferrer"
                           style={{ fontSize: "0.76rem" }}>
                          ver el archivo de esta versión ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
