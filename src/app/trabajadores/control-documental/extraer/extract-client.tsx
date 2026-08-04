"use client";

import { useRef, useState, useTransition } from "react";
import type { DragEvent } from "react";
import { extractDocumentsAction, applyExtractionsAction, type ExtractedRow } from "./actions";

type Worker = { id: string; fullName: string; nationalId: string | null };
type DocType = { id: string; codigo: string; nombre: string };

// Fila que gestionamos en el cliente — parte de ExtractedRow pero editable
type EditableRow = {
  clientFileId: string;
  fileName: string;
  fileUrl: string;          // preview local (blob URL)
  detectedTipoId: string | null;
  detectedDocTypeLabel: string;
  expiryDate: string | null;
  workerName: string | null;
  workerRut: string | null;
  workerId: string | null;  // el que el usuario seleccionó, o CREAR_NUEVO
  nuevoNombre: string;      // editable cuando workerId === CREAR_NUEVO
  nuevoRut: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  error?: string;
  applied?: boolean;         // ya se guardó
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data:...base64,XXX → dejar solo XXX
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Valor especial del select: crear un trabajador con los datos detectados. */
const CREAR_NUEVO = "__crear__";

const CONFIDENCE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  high:   { bg: "#dcfce7", color: "#166534", label: "✓ Alta" },
  medium: { bg: "#fef3c7", color: "#854d0e", label: "~ Media" },
  low:    { bg: "#fee2e2", color: "#991b1b", label: "! Baja" },
};

export function ExtractClient({
  workers,
  docTypes,
  apiKeyMissing,
}: {
  workers: Worker[];
  docTypes: DocType[];
  apiKeyMissing: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ applied: number; creados: number; errors: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleFiles(fileList: FileList | File[]) {
    setGlobalError(null);
    setApplyResult(null);

    const files = Array.from(fileList);
    if (files.length === 0) return;

    const invalid = files.filter(f => !ACCEPTED_TYPES.includes(f.type));
    if (invalid.length > 0) {
      const pdfs = invalid.filter(f => f.type === "application/pdf");
      if (pdfs.length > 0) {
        setGlobalError(
          `${pdfs.length} archivo(s) son PDFs. Convertí el PDF a imagen (JPG/PNG) o sacale una foto con el celular. Formatos aceptados: JPG, PNG, WEBP.`
        );
      } else {
        setGlobalError(`Formato no soportado en ${invalid.length} archivo(s). Aceptados: JPG, PNG, WEBP.`);
      }
      return;
    }

    // Placeholders inmediatos mientras la IA procesa
    const placeholders: EditableRow[] = await Promise.all(
      files.map(async (f, i): Promise<EditableRow> => ({
        clientFileId: `${Date.now()}-${i}`,
        fileName: f.name,
        fileUrl: URL.createObjectURL(f),
        detectedTipoId: null,
        detectedDocTypeLabel: "Procesando…",
        expiryDate: null,
        workerName: null,
        workerRut: null,
        workerId: null,
        nuevoNombre: "",
        nuevoRut: "",
        confidence: "low",
        reasoning: "",
      }))
    );
    setRows(prev => [...prev, ...placeholders]);

    // Enviar al server
    startTransition(async () => {
      try {
        const payload = await Promise.all(
          files.map(async (f, i) => ({
            clientFileId: placeholders[i].clientFileId,
            fileName: f.name,
            mimeType: f.type,
            base64: await fileToBase64(f),
          }))
        );

        const results = await extractDocumentsAction(payload);

        // Merge de resultados con placeholders
        setRows(prev => prev.map(r => {
          const result = results.find(res => res.clientFileId === r.clientFileId);
          if (!result) return r;
          const bestMatch = result.matches[0] ?? null;
          // Sin match pero con nombre legible → proponemos crearlo.
          const proponerCrear = !bestMatch && Boolean(result.workerName?.trim());
          return {
            ...r,
            detectedTipoId: result.detectedTipoId,
            detectedDocTypeLabel: result.detectedDocTypeLabel,
            expiryDate: result.expiryDate,
            workerName: result.workerName,
            workerRut: result.workerRut,
            workerId: bestMatch?.workerId ?? (proponerCrear ? CREAR_NUEVO : null),
            nuevoNombre: result.workerName ?? "",
            nuevoRut: result.workerRut ?? "",
            confidence: result.confidence,
            reasoning: result.reasoning,
            error: result.error,
          };
        }));
      } catch (e) {
        setGlobalError(`Error al procesar: ${(e as Error).message}`);
      }
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  function updateRow(clientFileId: string, changes: Partial<EditableRow>) {
    setRows(prev => prev.map(r => r.clientFileId === clientFileId ? { ...r, ...changes } : r));
  }

  function removeRow(clientFileId: string) {
    setRows(prev => {
      const target = prev.find(r => r.clientFileId === clientFileId);
      if (target) URL.revokeObjectURL(target.fileUrl);
      return prev.filter(r => r.clientFileId !== clientFileId);
    });
  }

  function resetAll() {
    rows.forEach(r => URL.revokeObjectURL(r.fileUrl));
    setRows([]);
    setApplyResult(null);
    setGlobalError(null);
  }

  const readyRows = rows.filter(r =>
    !r.applied &&
    !r.error &&
    r.expiryDate &&
    r.detectedTipoId &&
    (r.workerId === CREAR_NUEVO ? Boolean(r.nuevoNombre.trim()) : Boolean(r.workerId))
  );

  const aCrear = new Set(
    readyRows.filter(r => r.workerId === CREAR_NUEVO)
      .map(r => (r.nuevoRut.trim() || r.nuevoNombre.trim()).toLowerCase())
  ).size;

  function handleApply() {
    if (readyRows.length === 0) return;
    startTransition(async () => {
      const result = await applyExtractionsAction(
        readyRows.map(r => ({
          workerId: r.workerId === CREAR_NUEVO ? null : r.workerId,
          nuevoTrabajador: r.workerId === CREAR_NUEVO
            ? { nombre: r.nuevoNombre.trim(), rut: r.nuevoRut.trim() || null }
            : null,
          tipoDocumentoId: r.detectedTipoId!,
          confidence: r.confidence,
          expiryDate: r.expiryDate!,
        }))
      );
      // Marcar filas como aplicadas
      const appliedIds = new Set(readyRows.map(r => r.clientFileId));
      setRows(prev => prev.map(r =>
        appliedIds.has(r.clientFileId) ? { ...r, applied: true } : r
      ));
      setApplyResult({ applied: result.applied, creados: result.creados.length, errors: result.errors.length });
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Drop zone */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: "none" }}
        onChange={e => e.target.files && handleFiles(e.target.files)}
      />
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragEnter={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onClick={() => !apiKeyMissing && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--teal)" : "#cbd5e1"}`,
          borderRadius: 16,
          padding: "40px 24px",
          textAlign: "center",
          cursor: apiKeyMissing ? "not-allowed" : "pointer",
          background: apiKeyMissing ? "#f8fafc" : dragging ? "#f0fdf4" : "#fafbfc",
          opacity: apiKeyMissing ? 0.6 : 1,
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>📷</div>
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "#475569" }}>
          {apiKeyMissing ? "OPENAI_API_KEY no configurada" : dragging ? "Soltá acá" : "Arrastrá fotos o hacé clic para seleccionar"}
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: 6 }}>
          JPG, PNG, WEBP — múltiples archivos a la vez
        </div>
      </div>

      {globalError && (
        <div className="alert error">{globalError}</div>
      )}

      {applyResult && (
        <div className="alert success">
          ✅ Se guardaron <strong>{applyResult.applied}</strong> documento{applyResult.applied !== 1 ? "s" : ""}
          {applyResult.creados > 0 && <> · se crearon <strong>{applyResult.creados}</strong> trabajador{applyResult.creados !== 1 ? "es" : ""}</>}
          {applyResult.errors > 0 && <> · {applyResult.errors} error(es)</>}
        </div>
      )}

      {/* Tabla de resultados */}
      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontWeight: 700 }}>
              {rows.length} archivo{rows.length !== 1 ? "s" : ""} ·
              <span style={{ color: "#166534", marginLeft: 8 }}>{readyRows.length} listos</span>
            </div>
            <button
              type="button"
              onClick={resetAll}
              style={{ background: "transparent", border: "1px solid var(--border)", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem" }}
            >
              🗑 Limpiar todo
            </button>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", width: 60 }}>Preview</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", minWidth: 180 }}>Archivo</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Confianza</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", minWidth: 200 }}>Trabajador</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Tipo de documento</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Vencimiento</th>
                    <th style={{ padding: "10px 12px", width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const conf = CONFIDENCE_STYLE[row.confidence];
                    const isProcessing = row.detectedDocTypeLabel === "Procesando…";
                    const canApply = !row.applied && !row.error && row.workerId && row.expiryDate && row.detectedTipoId;
                    return (
                      <tr key={row.clientFileId} style={{ borderBottom: "1px solid #f1f5f9", background: row.applied ? "#f0fdf4" : row.error ? "#fef2f2" : undefined }}>
                        <td style={{ padding: "8px 12px" }}>
                          <img src={row.fileUrl} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                            {row.fileName}
                          </div>
                          {row.applied && <div style={{ color: "#166534", fontSize: "0.72rem", fontWeight: 700 }}>✓ Guardado</div>}
                          {row.error && <div style={{ color: "#991b1b", fontSize: "0.72rem" }}>❌ {row.error}</div>}
                          {row.reasoning && !row.error && (
                            <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: 2 }} title={row.reasoning}>
                              {row.reasoning.slice(0, 50)}{row.reasoning.length > 50 ? "…" : ""}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {isProcessing ? (
                            <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>⏳</span>
                          ) : (
                            <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: conf.bg, color: conf.color }}>
                              {conf.label}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {isProcessing ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : (
                            <select
                              value={row.workerId ?? ""}
                              onChange={e => updateRow(row.clientFileId, { workerId: e.target.value || null })}
                              disabled={row.applied}
                              style={{ padding: "5px 8px", fontSize: "0.82rem", width: "100%", maxWidth: 240 }}
                            >
                              <option value="">— Sin asignar —</option>
                              <option value={CREAR_NUEVO}>➕ Crear trabajador nuevo</option>
                              {workers.map(w => (
                                <option key={w.id} value={w.id}>
                                  {w.fullName}{w.nationalId ? ` · ${w.nationalId}` : ""}
                                </option>
                              ))}
                            </select>
                          )}

                          {/* Datos del trabajador a crear — editables antes de guardar */}
                          {row.workerId === CREAR_NUEVO && !row.applied && (
                            <div style={{ display: "grid", gap: 4, marginTop: 6, padding: 8, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8 }}>
                              <input
                                value={row.nuevoNombre}
                                onChange={e => updateRow(row.clientFileId, { nuevoNombre: e.target.value })}
                                placeholder="Nombre completo"
                                style={{ padding: "5px 8px", fontSize: "0.8rem", width: "100%", boxSizing: "border-box" }}
                              />
                              <input
                                value={row.nuevoRut}
                                onChange={e => updateRow(row.clientFileId, { nuevoRut: e.target.value })}
                                placeholder="RUT (opcional)"
                                style={{ padding: "5px 8px", fontSize: "0.8rem", width: "100%", boxSizing: "border-box" }}
                              />
                              <div style={{ fontSize: "0.68rem", color: "#166534" }}>
                                Se crea la ficha con estos datos. Si varios documentos traen el mismo RUT, se agrupan en un solo trabajador.
                              </div>
                            </div>
                          )}

                          {row.workerName && !isProcessing && row.workerId !== CREAR_NUEVO && (
                            <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: 2 }}>
                              Detectado: {row.workerName}
                              {row.workerRut && ` (${row.workerRut})`}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {isProcessing ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : (
                            <select
                              value={row.detectedTipoId ?? ""}
                              onChange={e => updateRow(row.clientFileId, { detectedTipoId: e.target.value || null })}
                              disabled={row.applied}
                              style={{ padding: "5px 8px", fontSize: "0.82rem" }}
                            >
                              <option value="unknown">— Elegir —</option>
                              {docTypes.map(t => (
                                <option key={t.id} value={t.id}>{t.nombre}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {isProcessing ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : (
                            <input
                              type="date"
                              value={row.expiryDate ?? ""}
                              onChange={e => updateRow(row.clientFileId, { expiryDate: e.target.value || null })}
                              disabled={row.applied}
                              style={{ padding: "4px 8px", fontSize: "0.82rem", width: 130 }}
                            />
                          )}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          {!row.applied && (
                            <button
                              type="button"
                              onClick={() => removeRow(row.clientFileId)}
                              title="Quitar"
                              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}
                            >
                              ✕
                            </button>
                          )}
                          {canApply && (
                            <span style={{ color: "#16a34a", fontSize: "0.72rem", fontWeight: 700 }}>listo</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Botón de aplicar */}
          {readyRows.length > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                onClick={handleApply}
                disabled={isPending}
                style={{
                  padding: "10px 24px",
                  borderRadius: 10,
                  background: isPending ? "#94a3b8" : "var(--teal)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.92rem",
                  border: "none",
                  cursor: isPending ? "not-allowed" : "pointer",
                }}
              >
                {isPending
                  ? "Guardando…"
                  : `💾 Guardar ${readyRows.length} documento${readyRows.length !== 1 ? "s" : ""}` +
                    (aCrear > 0 ? ` · crear ${aCrear} trabajador${aCrear !== 1 ? "es" : ""}` : "")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
