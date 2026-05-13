"use client";

import { useRef, useState } from "react";
import type { DragEvent, ChangeEvent } from "react";
import { subirDocumentoAction } from "./actions";

const CATEGORIAS = [
  "Procedimientos", "Reglamentos", "Formularios", "Planos",
  "Contratos", "HSEC", "Capacitaciones", "Informes", "Otros",
];

export function SubirForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]   = useState(false);
  const [file, setFile]           = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && fileInputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(dropped);
      fileInputRef.current.files = dt.files;
      setFile(dropped);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    // Only leave if actually leaving the zone (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  function fmtSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  return (
    <form
      action={subirDocumentoAction}
      encType="multipart/form-data"
      onSubmit={() => setSubmitting(true)}
      style={{ display: "grid", gap: 10 }}
    >
      <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--teal)" }}>Subir documento</h3>

      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
          Título *
        </label>
        <input name="titulo" required placeholder="Ej: Procedimiento de emergencias" style={{ padding: "7px 10px" }} />
      </div>

      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
          Categoría *
        </label>
        <select name="categoria" required style={{ padding: "7px 10px" }}>
          <option value="">— Seleccionar —</option>
          {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
            Descripción
          </label>
          <input name="descripcion" placeholder="Breve descripción" style={{ padding: "7px 10px" }} />
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
            Versión
          </label>
          <input name="version" placeholder="1.0" style={{ padding: "7px 10px" }} />
        </div>
      </div>

      {/* ── Drop zone ── */}
      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 6 }}>
          Archivo *
        </label>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "var(--teal)" : "#cbd5e1"}`,
            borderRadius: 12,
            padding: file ? "14px 16px" : "28px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? "#f0fdf4" : file ? "#f8fafc" : "#fafbfc",
            transition: "all 0.15s ease",
            userSelect: "none",
          }}
        >
          {file ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "1.8rem", flexShrink: 0 }}>📎</span>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{
                  fontWeight: 700, fontSize: "0.88rem", color: "var(--teal)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {file.name}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 2 }}>
                  {fmtSize(file.size)} · <span style={{ color: "var(--accent)", fontWeight: 600 }}>clic para cambiar</span>
                </div>
              </div>
              <span style={{ fontSize: "1.2rem", color: "#16a34a", flexShrink: 0 }}>✓</span>
            </div>
          ) : dragging ? (
            <>
              <div style={{ fontSize: "2.4rem", marginBottom: 6 }}>📂</div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--teal)" }}>
                Soltá el archivo acá
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: "2.2rem", marginBottom: 6 }}>☁️</div>
              <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#64748b" }}>
                Arrastrá el archivo acá
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 4 }}>
                o hacé <span style={{ color: "var(--accent)", fontWeight: 600 }}>clic para seleccionar</span>
              </div>
              <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 6 }}>
                PDF · Word · Excel · PPT · Imagen · ZIP
              </div>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            name="archivo"
            required
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.zip,.rar,.txt,.csv"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        style={{ padding: "9px 0", borderRadius: 8, opacity: submitting ? 0.7 : 1 }}
      >
        {submitting ? "Subiendo…" : "↑ Subir documento"}
      </button>
    </form>
  );
}
