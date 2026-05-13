"use client";

import { useState, useRef, useTransition } from "react";
import type { DragEvent } from "react";
import * as XLSX from "xlsx";
import { importarTrabajadoresAction } from "./actions";
import type { WorkerImportRow, ImportResult } from "./actions";

// ── Mapeo flexible de headers ─────────────────────────────────────────────────
function norm(s: string) {
  // Unicode escape explícito U+0300–U+036F para máxima compatibilidad con bundlers
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Busca una columna que coincida exactamente o que contenga alguna de las palabras clave
function findColByVariants(keys: string[], variants: string[]): string | undefined {
  const normedKeys = keys.map(k => ({ orig: k, norm: norm(k) }));
  // 1) Coincidencia exacta
  for (const v of variants) {
    const found = normedKeys.find(k => k.norm === v);
    if (found) return found.orig;
  }
  // 2) Coincidencia por inclusión (fallback robusto)
  for (const v of variants) {
    const found = normedKeys.find(k => k.norm.includes(v) || v.includes(k.norm));
    if (found) return found.orig;
  }
  return undefined;
}

const HEADER_MAP: Record<string, keyof WorkerImportRow> = {
  // fullName (nombre completo en una sola celda)
  "nombre": "fullName", "nombre completo": "fullName", "full name": "fullName", "nombre trabajador": "fullName",
  // nationalId
  "rut": "nationalId", "cedula": "nationalId", "nacional id": "nationalId", "dni": "nationalId",
  // role
  "cargo": "role", "puesto": "role", "posicion": "role", "role": "role",
  // employerCompany
  "empresa": "employerCompany", "empresa empleadora": "employerCompany", "razon social": "employerCompany",
  // phone
  "telefono": "phone", "celular": "phone", "phone": "phone", "movil": "phone",
  // personalEmail
  "email": "personalEmail", "correo": "personalEmail", "correo electronico": "personalEmail", "personal email": "personalEmail",
  // campamento
  "campamento": "campamento", "camp": "campamento", "sede": "campamento", "faena": "campamento",
  // shiftPattern
  "turno": "shiftPattern", "patron turno": "shiftPattern", "shift": "shiftPattern", "ciclo": "shiftPattern",
  // shiftStartDate
  "inicio turno": "shiftStartDate", "fecha inicio": "shiftStartDate", "fecha inicio turno": "shiftStartDate",
  // contractEndDate
  "venc contrato": "contractEndDate", "vencimiento contrato": "contractEndDate", "fin contrato": "contractEndDate", "contract end": "contractEndDate",
  // driversLicenseDueDate
  "venc licencia": "driversLicenseDueDate", "licencia conducir": "driversLicenseDueDate", "venc licencia conducir": "driversLicenseDueDate",
  // altitudeExamDueDate
  "examen altura": "altitudeExamDueDate", "venc examen altura": "altitudeExamDueDate", "altura fisica": "altitudeExamDueDate",
  // occupationalExamDueDate
  "examen ocupacional": "occupationalExamDueDate", "venc examen ocupacional": "occupationalExamDueDate", "examen preocupacional": "occupationalExamDueDate",
  // accreditationDueDate
  "acreditacion": "accreditationDueDate", "venc acreditacion": "accreditationDueDate", "credencial": "accreditationDueDate",
  // notes
  "notas": "notes", "observaciones": "notes", "comentarios": "notes", "notes": "notes",
};

// Columnas de nombre separado (formato dotación chilena típica)
const SPLIT_NAME_COLS = {
  apellidoPaterno: ["apellido paterno", "ap. paterno", "primer apellido", "apellido1", "paterno"],
  apellidoMaterno: ["apellido materno", "ap. materno", "segundo apellido", "apellido2", "materno"],
  nombres:         ["nombres", "nombre(s)", "primer nombre", "nombres propios"],
  tipoContrato:    ["tipo contrato", "tipo de contrato"],
};

const VALID_SHIFTS = ["14x14", "10x10", "7x7", "4x3"];

type ParsedRow = WorkerImportRow & {
  __rowNum: number;
  __errors: string[];
};

function excelDateToStr(val: unknown): string {
  if (!val) return "";
  if (val instanceof Date) {
    const d = val;
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${String(d.d).padStart(2, "0")}/${String(d.m).padStart(2, "0")}/${d.y}`;
  }
  return String(val);
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function parseExcel(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "binary", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

        if (raw.length === 0) { resolve([]); return; }

        const sampleKeys = Object.keys(raw[0]);

        // ── Mapeo de columnas estándar ──────────────────────────────────────
        const fieldMap: Record<string, keyof WorkerImportRow> = {};
        for (const key of sampleKeys) {
          const mapped = HEADER_MAP[norm(key)];
          if (mapped) fieldMap[key] = mapped;
        }

        // ── Detección de columnas de nombre separado ────────────────────────
        const colApePaterno   = findColByVariants(sampleKeys, SPLIT_NAME_COLS.apellidoPaterno);
        const colApeMaterno   = findColByVariants(sampleKeys, SPLIT_NAME_COLS.apellidoMaterno);
        const colNombres      = findColByVariants(sampleKeys, SPLIT_NAME_COLS.nombres);
        const colTipoContrato = findColByVariants(sampleKeys, SPLIT_NAME_COLS.tipoContrato);
        const hasSplitName    = Boolean(colApePaterno || colNombres);

        const rows: ParsedRow[] = raw.map((rawRow, idx) => {
          const row: Partial<WorkerImportRow> = {};

          for (const [colKey, field] of Object.entries(fieldMap)) {
            const val = rawRow[colKey];
            if (field.endsWith("Date") || field === "shiftStartDate") {
              row[field] = excelDateToStr(val) as never;
            } else {
              row[field] = (val != null ? String(val).trim() : "") as never;
            }
          }

          // ── Combinar nombre desde columnas separadas ──────────────────────
          if (hasSplitName && !row.fullName?.trim()) {
            const nombres    = colNombres    ? String(rawRow[colNombres]    ?? "").trim() : "";
            const apePaterno = colApePaterno ? String(rawRow[colApePaterno] ?? "").trim() : "";
            const apeMaterno = colApeMaterno ? String(rawRow[colApeMaterno] ?? "").trim() : "";
            const combined   = [nombres, apePaterno, apeMaterno].filter(Boolean).join(" ");
            row.fullName     = toTitleCase(combined);
          }

          // ── Tipo de contrato → notas ──────────────────────────────────────
          if (colTipoContrato) {
            const tipo = String(rawRow[colTipoContrato] ?? "").trim();
            if (tipo) {
              const label = tipo === "PlazoFijo" ? "Plazo fijo"
                          : tipo === "Indefinido" ? "Indefinido"
                          : tipo;
              row.notes = row.notes?.trim()
                ? `${row.notes.trim()} · Contrato: ${label}`
                : `Contrato: ${label}`;
            }
          }

          const errors: string[] = [];
          if (!row.fullName?.trim()) errors.push("Nombre obligatorio");
          if (row.shiftPattern && !VALID_SHIFTS.includes(row.shiftPattern.trim())) {
            errors.push(`Turno inválido (${row.shiftPattern}) — usar: 14x14, 10x10, 7x7, 4x3`);
          }
          if (row.personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.personalEmail)) {
            errors.push("Email inválido");
          }

          return { ...row, __rowNum: idx + 2, __errors: errors } as ParsedRow;
        });

        resolve(rows.filter(r => r.fullName?.trim() || r.__errors.length > 0));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsBinaryString(file);
  });
}

function downloadTemplate() {
  const headers = [
    "Nombre completo", "RUT", "Cargo", "Empresa empleadora",
    "Teléfono", "Email", "Campamento",
    "Turno", "Inicio turno",
    "Venc. contrato", "Venc. licencia", "Examen altura",
    "Examen ocupacional", "Acreditación", "Notas",
  ];
  const example = [
    "Juan Pérez González", "12.345.678-9", "SUPERVISOR", "Constructora Norte SpA",
    "+56912345678", "juan@email.com", "Campamento Norte",
    "14x14", "01/03/2025",
    "31/12/2025", "15/06/2026", "30/03/2026",
    "30/03/2026", "30/09/2025", "",
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Trabajadores");
  XLSX.writeFile(wb, "plantilla_trabajadores.xlsx");
}

// ── Componente principal ──────────────────────────────────────────────────────
type Camp = { id: string; name: string };

export function ImportWorkers({ camps = [] }: { camps?: Camp[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]       = useState(false);
  const [rows, setRows]               = useState<ParsedRow[] | null>(null);
  const [filename, setFilename]       = useState("");
  const [parseError, setParseError]   = useState<string | null>(null);
  const [result, setResult]           = useState<ImportResult | null>(null);
  const [selectedCampId, setSelectedCampId] = useState<string>("");
  const [isPending, startTransition]  = useTransition();

  const validRows   = rows?.filter(r => r.__errors.length === 0) ?? [];
  const invalidRows = rows?.filter(r => r.__errors.length > 0)   ?? [];
  // ¿Las filas traen campamento propio?
  const hasFileCamp = validRows.some(r => r.campamento?.trim());

  async function handleFile(file: File) {
    setParseError(null);
    setRows(null);
    setResult(null);
    setFilename(file.name);
    try {
      const parsed = await parseExcel(file);
      setRows(parsed);
    } catch {
      setParseError("No se pudo leer el archivo. Asegurate de que sea un Excel (.xlsx/.xls) o CSV.");
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  function handleImport() {
    if (validRows.length === 0) return;
    startTransition(async () => {
      const res = await importarTrabajadoresAction(validRows, selectedCampId || undefined);
      setResult(res);
    });
  }

  function reset() {
    setRows(null); setResult(null); setFilename(""); setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Resultado final ──
  if (result) {
    return (
      <div className="card" style={{ maxWidth: 600, margin: "0 auto", padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: "3rem", marginBottom: 12 }}>
          {result.errors.length === 0 ? "✅" : "⚠️"}
        </div>
        <h2 style={{ marginTop: 0 }}>Importación completada</h2>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 20 }}>
          <div style={{ padding: "12px 24px", borderRadius: 12, background: "#dcfce7", color: "#166534" }}>
            <div style={{ fontSize: "1.8rem", fontWeight: 900 }}>{result.created}</div>
            <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>creados</div>
          </div>
          {result.skipped > 0 && (
            <div style={{ padding: "12px 24px", borderRadius: 12, background: "#f1f5f9", color: "#64748b" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 900 }}>{result.skipped}</div>
              <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>omitidos</div>
            </div>
          )}
          {result.errors.length > 0 && (
            <div style={{ padding: "12px 24px", borderRadius: 12, background: "#fee2e2", color: "#991b1b" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 900 }}>{result.errors.length}</div>
              <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>errores</div>
            </div>
          )}
        </div>
        {result.errors.length > 0 && (
          <div style={{ textAlign: "left", marginBottom: 20 }}>
            {result.errors.map((e, i) => (
              <div key={i} style={{ padding: "6px 10px", marginBottom: 4, borderRadius: 6, background: "#fee2e2", color: "#991b1b", fontSize: "0.82rem" }}>
                <strong>Fila {e.fila} — {e.nombre}:</strong> {e.error}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <a href="/trabajadores" style={{
            padding: "9px 20px", borderRadius: 8, background: "var(--teal)", color: "#fff",
            fontWeight: 700, textDecoration: "none", fontSize: "0.9rem",
          }}>
            Ver trabajadores →
          </a>
          <button onClick={reset} style={{ padding: "9px 20px", borderRadius: 8, background: "#f1f5f9", border: "1px solid var(--border)", fontWeight: 600, cursor: "pointer" }}>
            Nueva importación
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>

      {/* Campamento por defecto */}
      {camps.length > 0 && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontWeight: 700, fontSize: "0.9rem", display: "block", marginBottom: 4 }}>
              🏕️ Campamento por defecto
            </label>
            <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
              Se asigna a todos los trabajadores del archivo que no tengan campamento propio.
            </div>
          </div>
          <select
            value={selectedCampId}
            onChange={e => setSelectedCampId(e.target.value)}
            style={{ minWidth: 220, padding: "8px 12px", borderRadius: 8, border: "1.5px solid var(--border)", fontWeight: 600 }}
          >
            <option value="">Sin asignar campamento</option>
            {camps.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Instrucciones + plantilla */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem" }}>📋 Formatos soportados</h3>
          <ul style={{ margin: "8px 0 0 0", paddingLeft: 18, fontSize: "0.84rem", color: "var(--muted)", lineHeight: 1.7 }}>
            <li>Formato dotación RRHH: <strong>RUT · Apellido Paterno · Apellido Materno · Nombres · Cargo · Tipo Contrato</strong></li>
            <li>Formato propio: <strong>Nombre completo · RUT · Cargo · Turno · Campamento · Fechas…</strong></li>
            <li>Los nombres se convierten a título (Ej: <em>JUAN PÉREZ → Juan Pérez</em>)</li>
            <li>Turno por defecto: <strong>14x14</strong> · Fecha inicio: <strong>hoy</strong></li>
          </ul>
        </div>
        <button
          onClick={downloadTemplate}
          style={{
            padding: "10px 20px", borderRadius: 10, background: "#f0fdf4",
            color: "#15803d", fontWeight: 700, border: "1.5px solid #86efac",
            cursor: "pointer", fontSize: "0.9rem", whiteSpace: "nowrap",
          }}
        >
          ⬇️ Plantilla Excel
        </button>
      </div>

      {/* Drop zone */}
      {!rows && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: "none" }}
            onChange={onFileChange}
          />
          <div
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragEnter={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "var(--teal)" : "#cbd5e1"}`,
              borderRadius: 16, padding: "48px 24px", textAlign: "center",
              cursor: "pointer", background: dragging ? "#f0fdf4" : "#fafbfc",
              transition: "all 0.15s",
            }}
          >
            {dragging ? (
              <><div style={{ fontSize: "3rem", marginBottom: 8 }}>📂</div>
              <div style={{ fontWeight: 700, color: "var(--teal)" }}>Soltá el archivo acá</div></>
            ) : (
              <>
                <div style={{ fontSize: "3rem", marginBottom: 10 }}>📊</div>
                <div style={{ fontWeight: 700, fontSize: "1rem", color: "#475569" }}>Arrastrá el Excel acá</div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 6 }}>
                  o hacé <span style={{ color: "var(--accent)", fontWeight: 700, textDecoration: "underline" }}>clic para seleccionar</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: 8 }}>.xlsx · .xls · .csv</div>
              </>
            )}
          </div>
          {parseError && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fee2e2", color: "#dc2626", fontWeight: 600, fontSize: "0.85rem" }}>
              ⚠️ {parseError}
            </div>
          )}
        </>
      )}

      {/* Preview */}
      {rows && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Summary bar */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
              📄 <strong>{filename}</strong>
            </span>
            <span style={{ padding: "3px 12px", borderRadius: 999, background: "#dcfce7", color: "#166534", fontWeight: 700, fontSize: "0.82rem" }}>
              ✓ {validRows.length} listos para importar
            </span>
            {invalidRows.length > 0 && (
              <span style={{ padding: "3px 12px", borderRadius: 999, background: "#fee2e2", color: "#991b1b", fontWeight: 700, fontSize: "0.82rem" }}>
                ✗ {invalidRows.length} con errores (se omitirán)
              </span>
            )}
            {!hasFileCamp && selectedCampId && (
              <span style={{ padding: "3px 12px", borderRadius: 999, background: "#e0f2fe", color: "#0369a1", fontWeight: 700, fontSize: "0.82rem" }}>
                🏕️ {camps.find(c => c.id === selectedCampId)?.name}
              </span>
            )}
            <button onClick={reset} style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 8, background: "#f1f5f9", border: "1px solid var(--border)", cursor: "pointer", fontSize: "0.82rem", color: "var(--muted)", fontWeight: 600 }}>
              ✕ Cambiar archivo
            </button>
          </div>

          {/* Tabla preview */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "2px solid var(--border)" }}>
                    {["#", "Nombre", "RUT", "Cargo", "Notas", "Campamento", "Estado"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: "var(--muted)", fontSize: "0.75rem", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const hasError = row.__errors.length > 0;
                    const campName = row.campamento?.trim()
                      ? row.campamento
                      : (selectedCampId ? camps.find(c => c.id === selectedCampId)?.name : "—");
                    return (
                      <tr key={row.__rowNum} style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: hasError ? "#fff5f5" : undefined,
                      }}>
                        <td style={{ padding: "7px 12px", color: "var(--muted)", fontSize: "0.75rem" }}>{row.__rowNum}</td>
                        <td style={{ padding: "7px 12px", fontWeight: 600 }}>{row.fullName || <span style={{ color: "#dc2626" }}>—</span>}</td>
                        <td style={{ padding: "7px 12px", color: "var(--muted)", whiteSpace: "nowrap" }}>{row.nationalId || "—"}</td>
                        <td style={{ padding: "7px 12px", color: "var(--muted)" }}>{row.role || "—"}</td>
                        <td style={{ padding: "7px 12px", color: "var(--muted)", fontSize: "0.75rem" }}>{row.notes || "—"}</td>
                        <td style={{ padding: "7px 12px", color: "var(--muted)" }}>{campName || "—"}</td>
                        <td style={{ padding: "7px 12px" }}>
                          {hasError ? (
                            <div>
                              {row.__errors.map((e, i) => (
                                <div key={i} style={{ fontSize: "0.73rem", color: "#dc2626", fontWeight: 600 }}>✗ {e}</div>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: "0.73rem", color: "#16a34a", fontWeight: 700 }}>✓ OK</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Botón importar */}
          {validRows.length > 0 && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button
                onClick={handleImport}
                disabled={isPending}
                style={{
                  padding: "11px 28px", borderRadius: 10,
                  background: isPending ? "#94a3b8" : "var(--teal)", color: "#fff",
                  fontWeight: 700, fontSize: "0.95rem", border: "none",
                  cursor: isPending ? "not-allowed" : "pointer",
                }}
              >
                {isPending ? "Importando…" : `Importar ${validRows.length} trabajador${validRows.length !== 1 ? "es" : ""}`}
              </button>
              {invalidRows.length > 0 && (
                <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                  Las {invalidRows.length} filas con errores se omitirán
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
          El archivo está vacío o no se encontraron filas de datos.
        </div>
      )}
    </div>
  );
}
