"use client";

import { useRef, useState, useTransition } from "react";
import type { DragEvent, ChangeEvent } from "react";
import { subirDocumentoAction } from "./actions";

const CATEGORIAS = [
  "Procedimientos", "Reglamentos", "Formularios", "Planos",
  "Contratos", "HSEC", "Capacitaciones", "Informes", "Otros",
];

// ── Inferir campos desde el nombre de archivo ─────────────────────────────
function inferFromFilename(filename: string) {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");

  // versión: v1, v1.0, v2.3, V3, etc.
  const versionMatch = nameWithoutExt.match(/[vV](\d+(?:[._]\d+)*)/);
  const version = versionMatch ? versionMatch[1].replace("_", ".") : "";

  // título: quitar la parte de versión, limpiar separadores
  const sinVersion = nameWithoutExt
    .replace(/[\s._-]*[vV]\d+(?:[._]\d+)*/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const titulo = sinVersion.charAt(0).toUpperCase() + sinVersion.slice(1);

  // categoría por palabras clave
  const lower = filename.toLowerCase();
  let categoria = "";
  if (/procedimiento|proc[_\s-]/.test(lower))                              categoria = "Procedimientos";
  else if (/reglamento|rgto/.test(lower))                                   categoria = "Reglamentos";
  else if (/formulario|form[_\s-]/.test(lower))                             categoria = "Formularios";
  else if (/plano/.test(lower))                                             categoria = "Planos";
  else if (/contrato/.test(lower))                                          categoria = "Contratos";
  else if (/hsec|seguridad|prevenci[oó]n|accidente|incidente/.test(lower)) categoria = "HSEC";
  else if (/capacitaci[oó]n|inducci[oó]n|curso|training/.test(lower))      categoria = "Capacitaciones";
  else if (/informe|reporte|report/.test(lower))                            categoria = "Informes";

  return { titulo, version, categoria };
}

// ─────────────────────────────────────────────────────────────────────────────

export function SubirForm() {
  const formRef      = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging]   = useState(false);
  const [file, setFile]           = useState<File | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // campos controlados para auto-relleno
  const [titulo,      setTitulo]      = useState("");
  const [categoria,   setCategoria]   = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [version,     setVersion]     = useState("");

  /* ── drag handlers ── */
  function onDragOver(e: DragEvent<HTMLDivElement>)  { e.preventDefault(); setDragging(true); }
  function onDragEnter(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setDragging(true); }
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) pickFile(dropped);
  }
  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) pickFile(picked);
  }

  function pickFile(f: File) {
    if (fileInputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(f);
      fileInputRef.current.files = dt.files;
    }
    setFile(f);
    setError(null);

    // auto-rellenar solo si el campo está vacío (no pisar lo que el usuario ya escribió)
    const inf = inferFromFilename(f.name);
    if (!titulo)    setTitulo(inf.titulo);
    if (!categoria) setCategoria(inf.categoria);
    if (!version)   setVersion(inf.version);
  }

  /* ── submit ── */
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!titulo.trim())   return setError("El título es obligatorio.");
    if (!categoria)       return setError("Seleccioná una categoría.");
    if (!file)            return setError("Seleccioná o arrastrá un archivo.");

    const fd = new FormData();
    fd.append("titulo",      titulo.trim());
    fd.append("categoria",   categoria);
    if (descripcion.trim()) fd.append("descripcion", descripcion.trim());
    if (version.trim())     fd.append("version",     version.trim());
    fd.append("archivo", file, file.name);

    startTransition(async () => { await subirDocumentoAction(fd); });
  }

  function fmtSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--teal)" }}>Subir documento</h3>

      {error && (
        <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fee2e2", color: "#dc2626", fontSize: "0.82rem", fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* ── Drop zone — va primero para que al soltar se auto-rellene lo de abajo ── */}
      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 6 }}>
          Archivo *
        </label>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.zip,.rar,.txt,.csv"
          style={{ display: "none" }}
          onChange={onFileChange}
          tabIndex={-1}
        />

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "var(--teal)" : file ? "#16a34a" : "#cbd5e1"}`,
            borderRadius: 12,
            padding: file ? "14px 16px" : "28px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? "#f0fdf4" : file ? "#f8fafc" : "#fafbfc",
            transition: "border-color 0.15s, background 0.15s",
            userSelect: "none",
          }}
        >
          {dragging ? (
            <>
              <div style={{ fontSize: "2.4rem", marginBottom: 6 }}>📂</div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--teal)" }}>Soltá el archivo acá</div>
            </>
          ) : file ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "1.8rem", flexShrink: 0 }}>📎</span>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--teal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.name}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 2 }}>
                  {fmtSize(file.size)} · <span style={{ color: "var(--accent)", fontWeight: 600 }}>clic para cambiar</span>
                </div>
              </div>
              <span style={{ fontSize: "1.2rem", color: "#16a34a", flexShrink: 0 }}>✓</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: "2.2rem", marginBottom: 6 }}>☁️</div>
              <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#64748b" }}>Arrastrá el archivo acá</div>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 4 }}>
                o hacé <span style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}>clic para seleccionar</span>
              </div>
              <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 6 }}>PDF · Word · Excel · PPT · Imagen · ZIP</div>
            </>
          )}
        </div>
      </div>

      {/* ── Campos (auto-rellenados si se detectaron) ── */}
      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
          Título *
        </label>
        <input
          value={titulo}
          onChange={e => setTitulo(e.target.value)}
          placeholder="Ej: Procedimiento de emergencias"
          style={{ padding: "7px 10px" }}
        />
      </div>

      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
          Categoría *
        </label>
        <select value={categoria} onChange={e => setCategoria(e.target.value)} style={{ padding: "7px 10px" }}>
          <option value="">— Seleccionar —</option>
          {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
            Descripción
          </label>
          <input
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Breve descripción"
            style={{ padding: "7px 10px" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
            Versión
          </label>
          <input
            value={version}
            onChange={e => setVersion(e.target.value)}
            placeholder="1.0"
            style={{ padding: "7px 10px" }}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        style={{ padding: "9px 0", borderRadius: 8, opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}
      >
        {isPending ? "Subiendo…" : "↑ Subir documento"}
      </button>
    </form>
  );
}
