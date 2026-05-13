"use client";

import { useState } from "react";

type DocMeta = {
  id: string;
  titulo: string;
  originalFilename: string;
  mimeType: string | null;
  fileSize: number | null;
  categoria: string;
  version: string | null;
};

function canPreview(mime: string | null) {
  if (!mime) return false;
  return (
    mime.includes("pdf") ||
    mime.startsWith("image/")
  );
}

function fmtSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function MimeIcon({ mime }: { mime: string | null }) {
  if (!mime) return <>📄</>;
  if (mime.includes("pdf"))                                          return <>📕</>;
  if (mime.includes("word") || mime.includes("document"))           return <>📘</>;
  if (mime.includes("sheet") || mime.includes("excel"))             return <>📗</>;
  if (mime.includes("presentation") || mime.includes("powerpoint")) return <>📙</>;
  if (mime.startsWith("image/"))                                     return <>🖼️</>;
  if (mime.includes("zip") || mime.includes("compressed"))          return <>🗜️</>;
  return <>📄</>;
}

export function PreviewButton({ doc }: { doc: DocMeta }) {
  const [open, setOpen] = useState(false);
  const previewable = canPreview(doc.mimeType);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Vista previa"
        style={{
          width: "auto", padding: "7px 11px", borderRadius: 8,
          background: "#f0f9ff", color: "#0369a1", fontWeight: 700,
          fontSize: "0.85rem", border: "1px solid #bae6fd", cursor: "pointer",
        }}
      >
        👁
      </button>

      {open && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{
            background: "#fff", borderRadius: 16, overflow: "hidden",
            width: "100%", maxWidth: 860,
            maxHeight: "90vh",
            display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>

            {/* Header */}
            <div style={{
              padding: "14px 20px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex", alignItems: "center", gap: 12,
              background: "#f8fafc",
            }}>
              <span style={{ fontSize: "1.6rem" }}><MimeIcon mime={doc.mimeType} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--teal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {doc.titulo}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 1 }}>
                  {doc.originalFilename} · {fmtSize(doc.fileSize)}
                  {doc.version && ` · v${doc.version}`}
                </div>
              </div>
              <a
                href={`/biblioteca/${doc.id}/download`}
                style={{
                  padding: "6px 14px", borderRadius: 8,
                  background: "var(--teal)", color: "#fff",
                  fontWeight: 700, fontSize: "0.82rem", textDecoration: "none",
                  flexShrink: 0,
                }}
              >
                ↓ Descargar
              </a>
              <button
                onClick={() => setOpen(false)}
                style={{
                  width: 32, height: 32, borderRadius: "50%", border: "none",
                  background: "#e2e8f0", cursor: "pointer", fontSize: "1rem",
                  fontWeight: 700, color: "#64748b", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              {previewable ? (
                doc.mimeType?.startsWith("image/") ? (
                  /* Imagen */
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#0f172a", minHeight: 400 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/biblioteca/${doc.id}/preview`}
                      alt={doc.titulo}
                      style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8, objectFit: "contain" }}
                    />
                  </div>
                ) : (
                  /* PDF */
                  <iframe
                    src={`/biblioteca/${doc.id}/preview`}
                    style={{ width: "100%", height: "72vh", border: "none", display: "block" }}
                    title={doc.titulo}
                  />
                )
              ) : (
                /* Sin preview */
                <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
                  <div style={{ fontSize: "3.5rem", marginBottom: 16 }}><MimeIcon mime={doc.mimeType} /></div>
                  <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 8 }}>
                    Este tipo de archivo no tiene vista previa
                  </div>
                  <div style={{ fontSize: "0.85rem", marginBottom: 24 }}>
                    {doc.mimeType?.includes("word")       && "Los archivos Word (.doc/.docx) deben descargarse para verse."}
                    {doc.mimeType?.includes("sheet")      && "Los archivos Excel (.xls/.xlsx) deben descargarse para verse."}
                    {doc.mimeType?.includes("presentation") && "Los archivos PowerPoint deben descargarse para verse."}
                    {(doc.mimeType?.includes("zip") || doc.mimeType?.includes("rar")) && "Los archivos comprimidos deben descargarse para verse."}
                    {!doc.mimeType?.includes("word") && !doc.mimeType?.includes("sheet") && !doc.mimeType?.includes("presentation") && !doc.mimeType?.includes("zip") && !doc.mimeType?.includes("rar")
                      && "Descargá el archivo para abrirlo."}
                  </div>
                  <a
                    href={`/biblioteca/${doc.id}/download`}
                    style={{
                      display: "inline-block", padding: "10px 24px", borderRadius: 10,
                      background: "var(--teal)", color: "#fff",
                      fontWeight: 700, fontSize: "0.9rem", textDecoration: "none",
                    }}
                  >
                    ↓ Descargar archivo
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
