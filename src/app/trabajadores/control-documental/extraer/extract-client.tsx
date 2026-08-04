"use client";

import { useRef, useState, useTransition } from "react";
import type { DragEvent } from "react";
import { extractDocumentsAction, applyExtractionsAction } from "./actions";

type Worker = { id: string; fullName: string; nationalId: string | null };
type DocType = { id: string; codigo: string; nombre: string };

/** Info del archivo subido, compartida por todas las filas que produjo. */
type ArchivoInfo = {
  clientFileId: string;
  fileName: string;
  fileUrl: string;   // blob URL para el preview
  esPdf: boolean;
};

/** Una fila editable = un documento detectado dentro de un archivo. */
type EditableRow = {
  rowId: string;
  clientFileId: string;
  procesando: boolean;
  detectedTipoId: string | null;
  detectedDocTypeLabel: string;
  expiryDate: string | null;
  issueDate: string | null;
  paginaInicio: number | null;
  workerName: string | null;
  workerRut: string | null;
  workerId: string | null;   // id existente, o CREAR_NUEVO
  nuevoNombre: string;
  nuevoRut: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  error?: string;
  applied?: boolean;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const MIME_PDF = "application/pdf";
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", MIME_PDF];
const MAX_FILE_MB = 18;

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
  const [archivos, setArchivos] = useState<ArchivoInfo[]>([]);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ applied: number; creados: number; errors: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  const infoDe = (clientFileId: string) => archivos.find(a => a.clientFileId === clientFileId);

  async function handleFiles(fileList: FileList | File[]) {
    setGlobalError(null);
    setApplyResult(null);

    const files = Array.from(fileList);
    if (files.length === 0) return;

    const invalidos = files.filter(f => !ACCEPTED_TYPES.includes(f.type));
    if (invalidos.length > 0) {
      setGlobalError(`Formato no soportado: ${invalidos.map(f => f.name).join(", ")}. Aceptados: PDF, JPG, PNG, WEBP.`);
      return;
    }

    const pesados = files.filter(f => f.size > MAX_FILE_MB * 1024 * 1024);
    if (pesados.length > 0) {
      setGlobalError(`Estos archivos superan ${MAX_FILE_MB} MB: ${pesados.map(f => f.name).join(", ")}. Comprimilos o dividí el PDF.`);
      return;
    }

    const nuevosArchivos: ArchivoInfo[] = files.map((f, i) => ({
      clientFileId: `${Date.now()}-${i}`,
      fileName: f.name,
      fileUrl: URL.createObjectURL(f),
      esPdf: f.type === MIME_PDF,
    }));
    setArchivos(prev => [...prev, ...nuevosArchivos]);

    // Una fila "procesando" por archivo, hasta que sepamos cuántos documentos trae
    setRows(prev => [
      ...prev,
      ...nuevosArchivos.map((a): EditableRow => ({
        rowId: `${a.clientFileId}#loading`,
        clientFileId: a.clientFileId,
        procesando: true,
        detectedTipoId: null,
        detectedDocTypeLabel: a.esPdf ? "Leyendo PDF…" : "Procesando…",
        expiryDate: null, issueDate: null, paginaInicio: null,
        workerName: null, workerRut: null, workerId: null,
        nuevoNombre: "", nuevoRut: "",
        confidence: "low", reasoning: "",
      })),
    ]);

    startTransition(async () => {
      try {
        const payload = await Promise.all(
          files.map(async (f, i) => ({
            clientFileId: nuevosArchivos[i].clientFileId,
            fileName: f.name,
            mimeType: f.type,
            base64: await fileToBase64(f),
          }))
        );

        const results = await extractDocumentsAction(payload);
        const idsProcesados = new Set(nuevosArchivos.map(a => a.clientFileId));

        setRows(prev => [
          // Sacamos los placeholders de estos archivos
          ...prev.filter(r => !(idsProcesados.has(r.clientFileId) && r.procesando)),
          // Y agregamos una fila por documento detectado
          ...results.map((res): EditableRow => {
            const bestMatch = res.matches[0] ?? null;
            const proponerCrear = !bestMatch && Boolean(res.workerName?.trim());
            return {
              rowId: res.rowId,
              clientFileId: res.clientFileId,
              procesando: false,
              detectedTipoId: res.detectedTipoId,
              detectedDocTypeLabel: res.detectedDocTypeLabel,
              expiryDate: res.expiryDate,
              issueDate: res.issueDate,
              paginaInicio: res.paginaInicio,
              workerName: res.workerName,
              workerRut: res.workerRut,
              workerId: bestMatch?.workerId ?? (proponerCrear ? CREAR_NUEVO : null),
              nuevoNombre: res.workerName ?? "",
              nuevoRut: res.workerRut ?? "",
              confidence: res.confidence,
              reasoning: res.reasoning,
              error: res.error,
            };
          }),
        ]);
      } catch (e) {
        setGlobalError(`Error al procesar: ${(e as Error).message}`);
        setRows(prev => prev.filter(r => !r.procesando));
      }
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  function updateRow(rowId: string, changes: Partial<EditableRow>) {
    setRows(prev => prev.map(r => r.rowId === rowId ? { ...r, ...changes } : r));
  }

  function removeRow(rowId: string) {
    setRows(prev => prev.filter(r => r.rowId !== rowId));
  }

  function resetAll() {
    archivos.forEach(a => URL.revokeObjectURL(a.fileUrl));
    setArchivos([]);
    setRows([]);
    setApplyResult(null);
    setGlobalError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const readyRows = rows.filter(r =>
    !r.procesando && !r.applied && !r.error &&
    r.expiryDate && r.detectedTipoId &&
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
          issueDate: r.issueDate,
        }))
      );
      const appliedIds = new Set(readyRows.map(r => r.rowId));
      setRows(prev => prev.map(r => appliedIds.has(r.rowId) ? { ...r, applied: true } : r));
      setApplyResult({ applied: result.applied, creados: result.creados.length, errors: result.errors.length });
    });
  }

  const totalDocs = rows.filter(r => !r.procesando).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,image/*"
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
        <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>📄</div>
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "#475569" }}>
          {apiKeyMissing
            ? "OPENAI_API_KEY no configurada"
            : dragging ? "Soltá acá" : "Arrastrá PDFs o fotos, o hacé clic para elegir"}
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: 6 }}>
          PDF, JPG, PNG, WEBP — varios a la vez · hasta {MAX_FILE_MB} MB cada uno
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 4 }}>
          Un PDF con la carpeta completa se separa en sus documentos automáticamente
        </div>
      </div>

      {globalError && <div className="alert error">{globalError}</div>}

      {applyResult && (
        <div className="alert success">
          ✅ Se guardaron <strong>{applyResult.applied}</strong> documento{applyResult.applied !== 1 ? "s" : ""}
          {applyResult.creados > 0 && <> · se crearon <strong>{applyResult.creados}</strong> trabajador{applyResult.creados !== 1 ? "es" : ""}</>}
          {applyResult.errors > 0 && <> · {applyResult.errors} error(es)</>}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontWeight: 700 }}>
              {archivos.length} archivo{archivos.length !== 1 ? "s" : ""} ·{" "}
              {totalDocs} documento{totalDocs !== 1 ? "s" : ""} detectado{totalDocs !== 1 ? "s" : ""} ·{" "}
              <span style={{ color: "#166534" }}>{readyRows.length} listo{readyRows.length !== 1 ? "s" : ""}</span>
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
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", width: 56 }}></th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", minWidth: 170 }}>Origen</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Confianza</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", minWidth: 210 }}>Trabajador</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", minWidth: 170 }}>Tipo de documento</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Vencimiento</th>
                    <th style={{ padding: "10px 12px", width: 34 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const info = infoDe(row.clientFileId);
                    const conf = CONFIDENCE_STYLE[row.confidence];
                    const listo = !row.procesando && !row.applied && !row.error
                      && row.expiryDate && row.detectedTipoId
                      && (row.workerId === CREAR_NUEVO ? row.nuevoNombre.trim() : row.workerId);

                    return (
                      <tr key={row.rowId} style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: row.applied ? "#f0fdf4" : row.error ? "#fef2f2" : undefined,
                      }}>
                        <td style={{ padding: "8px 12px" }}>
                          {info?.esPdf ? (
                            <div style={{ width: 40, height: 40, borderRadius: 6, background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem" }}>
                              📕
                            </div>
                          ) : info ? (
                            <img src={info.fileUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
                          ) : null}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }}>
                            {info?.fileName}
                          </div>
                          {row.paginaInicio && (
                            <div style={{ color: "var(--muted)", fontSize: "0.72rem" }}>página {row.paginaInicio}</div>
                          )}
                          {row.applied && <div style={{ color: "#166534", fontSize: "0.72rem", fontWeight: 700 }}>✓ Guardado</div>}
                          {row.error && <div style={{ color: "#991b1b", fontSize: "0.72rem" }}>❌ {row.error}</div>}
                          {row.reasoning && !row.error && (
                            <div style={{ color: "var(--muted)", fontSize: "0.7rem", marginTop: 2 }} title={row.reasoning}>
                              {row.reasoning.slice(0, 60)}{row.reasoning.length > 60 ? "…" : ""}
                            </div>
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          {row.procesando ? (
                            <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>⏳</span>
                          ) : (
                            <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: conf.bg, color: conf.color }}>
                              {conf.label}
                            </span>
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          {row.procesando ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : (
                            <>
                              <select
                                value={row.workerId ?? ""}
                                onChange={e => updateRow(row.rowId, { workerId: e.target.value || null })}
                                disabled={row.applied}
                                style={{ padding: "5px 8px", fontSize: "0.82rem", width: "100%", maxWidth: 250 }}
                              >
                                <option value="">— Sin asignar —</option>
                                <option value={CREAR_NUEVO}>➕ Crear trabajador nuevo</option>
                                {workers.map(w => (
                                  <option key={w.id} value={w.id}>
                                    {w.fullName}{w.nationalId ? ` · ${w.nationalId}` : ""}
                                  </option>
                                ))}
                              </select>

                              {row.workerId === CREAR_NUEVO && !row.applied && (
                                <div style={{ display: "grid", gap: 4, marginTop: 6, padding: 8, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8 }}>
                                  <input
                                    value={row.nuevoNombre}
                                    onChange={e => updateRow(row.rowId, { nuevoNombre: e.target.value })}
                                    placeholder="Nombre completo"
                                    style={{ padding: "5px 8px", fontSize: "0.8rem", width: "100%", boxSizing: "border-box" }}
                                  />
                                  <input
                                    value={row.nuevoRut}
                                    onChange={e => updateRow(row.rowId, { nuevoRut: e.target.value })}
                                    placeholder="RUT (opcional)"
                                    style={{ padding: "5px 8px", fontSize: "0.8rem", width: "100%", boxSizing: "border-box" }}
                                  />
                                  <div style={{ fontSize: "0.68rem", color: "#166534" }}>
                                    Los documentos con el mismo RUT se agrupan en un solo trabajador.
                                  </div>
                                </div>
                              )}

                              {row.workerName && row.workerId !== CREAR_NUEVO && (
                                <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: 2 }}>
                                  Detectado: {row.workerName}{row.workerRut && ` (${row.workerRut})`}
                                </div>
                              )}
                            </>
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          {row.procesando ? (
                            <span style={{ color: "var(--muted)" }}>{row.detectedDocTypeLabel}</span>
                          ) : (
                            <select
                              value={row.detectedTipoId ?? ""}
                              onChange={e => updateRow(row.rowId, { detectedTipoId: e.target.value || null })}
                              disabled={row.applied}
                              style={{ padding: "5px 8px", fontSize: "0.82rem", width: "100%", maxWidth: 190 }}
                            >
                              <option value="">— Elegir —</option>
                              {docTypes.map(t => (
                                <option key={t.id} value={t.id}>{t.nombre}</option>
                              ))}
                            </select>
                          )}
                        </td>

                        <td style={{ padding: "8px 12px" }}>
                          {row.procesando ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : (
                            <input
                              type="date"
                              value={row.expiryDate ?? ""}
                              onChange={e => updateRow(row.rowId, { expiryDate: e.target.value || null })}
                              disabled={row.applied}
                              style={{ padding: "4px 8px", fontSize: "0.82rem", width: 135 }}
                            />
                          )}
                        </td>

                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          {!row.applied && !row.procesando && (
                            <button
                              type="button"
                              onClick={() => removeRow(row.rowId)}
                              title="Descartar esta fila"
                              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}
                            >
                              ✕
                            </button>
                          )}
                          {listo && <div style={{ color: "#16a34a", fontSize: "0.7rem", fontWeight: 700 }}>listo</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {readyRows.length > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleApply}
                disabled={isPending}
                style={{
                  padding: "10px 24px", borderRadius: 10,
                  background: isPending ? "#94a3b8" : "var(--teal)",
                  color: "#fff", fontWeight: 700, fontSize: "0.92rem",
                  border: "none", cursor: isPending ? "not-allowed" : "pointer",
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
