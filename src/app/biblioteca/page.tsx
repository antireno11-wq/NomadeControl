import { AppShell } from "@/components/app-shell";
import { requireRole, BIBLIOTECA_ROLES, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { subirDocumentoAction, eliminarDocumentoAction } from "./actions";

type SearchParams = { status?: string; categoria?: string; q?: string };

const CATEGORIAS = [
  "Procedimientos",
  "Reglamentos",
  "Formularios",
  "Planos",
  "Contratos",
  "HSEC",
  "Capacitaciones",
  "Informes",
  "Otros",
];

function statusMsg(s?: string) {
  if (s === "uploaded") return { type: "success", text: "Documento subido correctamente." };
  if (s === "invalid")  return { type: "error",   text: "Faltan campos obligatorios." };
  if (s === "notfound") return { type: "error",   text: "Documento no encontrado." };
  return null;
}

function iconForMime(mime: string | null) {
  if (!mime) return "📄";
  if (mime.includes("pdf"))                                 return "📕";
  if (mime.includes("word") || mime.includes("document"))  return "📘";
  if (mime.includes("sheet") || mime.includes("excel"))    return "📗";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "📙";
  if (mime.includes("image"))                              return "🖼️";
  if (mime.includes("zip") || mime.includes("compressed")) return "🗜️";
  return "📄";
}

function fmtSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function BibliotecaPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(BIBLIOTECA_ROLES);
  const msg       = statusMsg(searchParams?.status);
  const catFiltro = searchParams?.categoria ?? "";
  const query     = searchParams?.q?.trim() ?? "";
  const esAdmin   = isAdminRole(user.role);

  const documentos = await db.documento.findMany({
    where: {
      ...(catFiltro ? { categoria: catFiltro } : {}),
      ...(query
        ? {
            OR: [
              { titulo:      { contains: query, mode: "insensitive" } },
              { descripcion: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, titulo: true, descripcion: true,
      categoria: true, originalFilename: true,
      fileSize: true, mimeType: true,
      version: true, subidoPor: true, createdAt: true,
    },
  });

  // Stats
  const total = documentos.length;
  const porCategoria: Record<string, number> = {};
  for (const d of documentos) {
    porCategoria[d.categoria] = (porCategoria[d.categoria] ?? 0) + 1;
  }

  return (
    <AppShell title="Biblioteca" user={{ name: user.name, role: user.role }} activeNav="biblioteca">
      {msg && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", borderRadius: 10,
          background: msg.type === "success" ? "#dcfce7" : "#fee2e2",
          color: msg.type === "success" ? "#15803d" : "#dc2626",
          fontWeight: 600,
        }}>
          {msg.text}
        </div>
      )}

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div className="card" style={{ flex: "0 0 auto", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "1.6rem", fontWeight: 900, color: "var(--teal)" }}>{total}</span>
          <span style={{ fontSize: "0.82rem", color: "var(--muted)", lineHeight: 1.3 }}>
            {catFiltro || query ? "resultados" : "documentos"}
            <br />en biblioteca
          </span>
        </div>
        {!catFiltro && !query && Object.entries(porCategoria).slice(0, 4).map(([cat, n]) => (
          <div key={cat} className="card" style={{ flex: "0 0 auto", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "1.3rem", fontWeight: 900, color: "var(--accent)" }}>{n}</span>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{cat}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <form method="GET" style={{ display: "contents" }}>
          <input
            name="q"
            defaultValue={query}
            placeholder="Buscar por título o descripción…"
            style={{ flex: "1 1 180px", minWidth: 160, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.9rem" }}
          />
          <select
            name="categoria"
            defaultValue={catFiltro}
            style={{ width: "auto", padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.9rem" }}
          >
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="submit" style={{ width: "auto", padding: "7px 16px", borderRadius: 8 }}>Buscar</button>
          {(catFiltro || query) && (
            <a href="/biblioteca" style={{ padding: "7px 12px", borderRadius: 8, background: "#f1f5f9", color: "var(--muted)", fontWeight: 600, fontSize: "0.88rem", textDecoration: "none", border: "1px solid var(--border)" }}>
              ✕ Limpiar
            </a>
          )}
        </form>

        {/* Upload — anyone with access can upload */}
        <details style={{ marginLeft: "auto" }}>
          <summary style={{
            cursor: "pointer", padding: "7px 16px", borderRadius: 8,
            background: "var(--accent)", color: "#fff", fontWeight: 700,
            fontSize: "0.9rem", listStyle: "none", display: "inline-block",
          }}>
            ↑ Subir documento
          </summary>
          <div className="card" style={{ position: "absolute", zIndex: 100, minWidth: 380, marginTop: 6, right: 24 }}>
            <SubirForm />
          </div>
        </details>
      </div>

      {/* Document grid */}
      {documentos.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>📂</div>
          <div style={{ fontWeight: 600 }}>No hay documentos{catFiltro ? ` en «${catFiltro}»` : query ? ` para «${query}»` : ""}</div>
          <div style={{ fontSize: "0.85rem", marginTop: 6 }}>Usá el botón "Subir documento" para agregar el primero.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {documentos.map(doc => (
            <div key={doc.id} className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Header */}
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: "2rem", lineHeight: 1 }}>{iconForMime(doc.mimeType)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--teal)", wordBreak: "break-word" }}>
                    {doc.titulo}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>
                    {doc.originalFilename}
                  </div>
                </div>
              </div>

              {/* Category + version */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{
                  display: "inline-block", padding: "2px 8px", borderRadius: 999,
                  fontSize: "0.73rem", fontWeight: 700,
                  background: "var(--teal)22", color: "var(--teal)",
                }}>
                  {doc.categoria}
                </span>
                {doc.version && (
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 999,
                    fontSize: "0.73rem", fontWeight: 700,
                    background: "#64748b22", color: "#64748b",
                  }}>
                    v{doc.version}
                  </span>
                )}
              </div>

              {/* Description */}
              {doc.descripcion && (
                <div style={{ fontSize: "0.82rem", color: "var(--muted)", lineHeight: 1.5 }}>
                  {doc.descripcion}
                </div>
              )}

              {/* Meta */}
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                <span>📅 {fmtDate(doc.createdAt)}</span>
                <span>💾 {fmtSize(doc.fileSize)}</span>
                {doc.subidoPor && <span>👤 {doc.subidoPor}</span>}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <a
                  href={`/biblioteca/${doc.id}/download`}
                  style={{
                    flex: 1, textAlign: "center", padding: "7px 0",
                    borderRadius: 8, background: "var(--teal)", color: "#fff",
                    fontWeight: 700, fontSize: "0.85rem", textDecoration: "none",
                  }}
                >
                  ↓ Descargar
                </a>
                {esAdmin && (
                  <EliminarForm docId={doc.id} titulo={doc.titulo} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

/* ─── Upload Form ──────────────────────────────────────────────── */
function SubirForm() {
  return (
    <form action={subirDocumentoAction} encType="multipart/form-data" style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--teal)" }}>Subir documento</h3>

      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Título *</label>
        <input name="titulo" required placeholder="Ej: Procedimiento de emergencias" style={{ padding: "7px 10px" }} />
      </div>

      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Categoría *</label>
        <select name="categoria" required style={{ padding: "7px 10px" }}>
          <option value="">— Seleccionar —</option>
          {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Descripción</label>
          <input name="descripcion" placeholder="Breve descripción" style={{ padding: "7px 10px" }} />
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Versión</label>
          <input name="version" placeholder="1.0" style={{ padding: "7px 10px" }} />
        </div>
      </div>

      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Archivo *</label>
        <input
          type="file"
          name="archivo"
          required
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.zip,.rar,.txt,.csv"
          style={{ padding: "6px 0", fontSize: "0.85rem" }}
        />
      </div>

      <button type="submit" style={{ padding: "9px 0", borderRadius: 8 }}>
        Subir
      </button>
    </form>
  );
}

/* ─── Delete Form ──────────────────────────────────────────────── */
function EliminarForm({ docId, titulo }: { docId: string; titulo: string }) {
  const action = eliminarDocumentoAction.bind(null, docId);
  return (
    <form action={action}>
      <button
        type="submit"
        title={`Eliminar «${titulo}»`}
        style={{
          width: "auto", padding: "7px 12px", borderRadius: 8,
          background: "#fee2e2", color: "#dc2626", fontWeight: 700,
          fontSize: "0.85rem", border: "1px solid #fca5a5",
        }}
      >
        🗑
      </button>
    </form>
  );
}
