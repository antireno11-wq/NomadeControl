import { AppShell } from "@/components/app-shell";
import { requireRole, BIBLIOTECA_ROLES, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { eliminarDocumentoAction } from "./actions";
import { SubirForm } from "./biblioteca-upload";
import { CATEGORIAS } from "./categorias";

type SearchParams = { status?: string; categoria?: string; q?: string };

const FOLDER_META: Record<string, { icon: string; color: string; bg: string }> = {
  Procedimientos: { icon: "📋", color: "#2563eb", bg: "#eff6ff" },
  Instructivos:   { icon: "📖", color: "#7c3aed", bg: "#f5f3ff" },
  Reglamentos:    { icon: "📜", color: "#b45309", bg: "#fffbeb" },
  Formularios:    { icon: "📝", color: "#0891b2", bg: "#ecfeff" },
  Planos:         { icon: "📐", color: "#475569", bg: "#f8fafc" },
  Contratos:      { icon: "🤝", color: "#15803d", bg: "#f0fdf4" },
  HSEC:           { icon: "🦺", color: "#dc2626", bg: "#fef2f2" },
  Capacitaciones: { icon: "🎓", color: "#7c3aed", bg: "#fdf4ff" },
  Informes:       { icon: "📊", color: "#0369a1", bg: "#f0f9ff" },
  Otros:          { icon: "📁", color: "#64748b", bg: "#f8fafc" },
};

function statusMsg(s?: string) {
  if (s === "uploaded") return { type: "success", text: "Documento subido correctamente." };
  if (s === "invalid")  return { type: "error",   text: "Faltan campos obligatorios." };
  if (s === "notfound") return { type: "error",   text: "Documento no encontrado." };
  return null;
}

function iconForMime(mime: string | null) {
  if (!mime) return "📄";
  if (mime.includes("pdf"))                                          return "📕";
  if (mime.includes("word") || mime.includes("document"))           return "📘";
  if (mime.includes("sheet") || mime.includes("excel"))             return "📗";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "📙";
  if (mime.includes("image"))                                        return "🖼️";
  if (mime.includes("zip") || mime.includes("compressed"))          return "🗜️";
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
  const user      = await requireRole(BIBLIOTECA_ROLES);
  const msg       = statusMsg(searchParams?.status);
  const catFiltro = searchParams?.categoria ?? "";
  const query     = searchParams?.q?.trim() ?? "";
  const esAdmin   = isAdminRole(user.role);

  const enCarpeta = !!catFiltro;
  const buscando  = !!query;
  const vistaPlana = enCarpeta || buscando;

  // Si estamos dentro de una carpeta o buscando → traer documentos filtrados
  // Si estamos en la raíz → traer conteos por categoría
  const [documentos, conteosPorCat] = await Promise.all([
    vistaPlana
      ? db.documento.findMany({
          where: {
            ...(catFiltro ? { categoria: catFiltro } : {}),
            ...(query
              ? { OR: [
                  { titulo:      { contains: query, mode: "insensitive" } },
                  { descripcion: { contains: query, mode: "insensitive" } },
                ] }
              : {}),
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, titulo: true, descripcion: true,
            categoria: true, originalFilename: true,
            fileSize: true, mimeType: true,
            version: true, subidoPor: true, createdAt: true,
          },
        })
      : Promise.resolve([]),

    !vistaPlana
      ? db.documento.groupBy({ by: ["categoria"], _count: { id: true } })
      : Promise.resolve([]),
  ]);

  const countMap: Record<string, number> = {};
  for (const row of conteosPorCat) {
    countMap[row.categoria] = row._count.id;
  }
  const totalDocs = Object.values(countMap).reduce((a, b) => a + b, 0);

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

      {/* ── Header con breadcrumb + botón subir ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>

        {/* Breadcrumb */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: "0.9rem" }}>
          <a href="/biblioteca" style={{
            fontWeight: enCarpeta || buscando ? 600 : 800,
            color: enCarpeta || buscando ? "var(--muted)" : "var(--teal)",
            textDecoration: "none",
            display: "flex", alignItems: "center", gap: 5,
          }}>
            🗄️ Biblioteca
          </a>
          {enCarpeta && (
            <>
              <span style={{ color: "var(--border)", fontWeight: 400 }}>/</span>
              <span style={{ fontWeight: 800, color: "var(--teal)", display: "flex", alignItems: "center", gap: 5 }}>
                {FOLDER_META[catFiltro]?.icon ?? "📁"} {catFiltro}
              </span>
            </>
          )}
          {buscando && !enCarpeta && (
            <>
              <span style={{ color: "var(--border)" }}>/</span>
              <span style={{ fontWeight: 700, color: "var(--muted)" }}>Resultados para «{query}»</span>
            </>
          )}
        </div>

        {/* Buscador global */}
        <form method="GET" style={{ display: "flex", gap: 6 }}>
          {catFiltro && <input type="hidden" name="categoria" value={catFiltro} />}
          <input
            name="q"
            defaultValue={query}
            placeholder="Buscar documentos…"
            style={{ width: 200, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.88rem" }}
          />
          <button type="submit" style={{ width: "auto", padding: "6px 14px", borderRadius: 8, fontSize: "0.88rem" }}>
            🔍
          </button>
          {(catFiltro || query) && (
            <a
              href={catFiltro ? `/biblioteca?categoria=${encodeURIComponent(catFiltro)}` : "/biblioteca"}
              style={{ padding: "6px 10px", borderRadius: 8, background: "#f1f5f9", color: "var(--muted)", fontWeight: 600, fontSize: "0.88rem", textDecoration: "none", border: "1px solid var(--border)", display: "flex", alignItems: "center" }}
            >
              ✕
            </a>
          )}
        </form>

        {/* Botón subir */}
        <details style={{ position: "relative" }}>
          <summary style={{
            cursor: "pointer", padding: "7px 16px", borderRadius: 8,
            background: "var(--accent)", color: "#fff", fontWeight: 700,
            fontSize: "0.9rem", listStyle: "none", display: "inline-block",
          }}>
            ↑ Subir documento
          </summary>
          <div className="card" style={{ position: "absolute", zIndex: 200, minWidth: 400, marginTop: 6, right: 0 }}>
            <SubirForm defaultCategoria={catFiltro} />
          </div>
        </details>
      </div>

      {/* ── Vista raíz: carpetas ── */}
      {!vistaPlana && (
        <>
          {/* Stat total */}
          <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 16 }}>
            {totalDocs} documento{totalDocs !== 1 ? "s" : ""} en total
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 14 }}>
            {CATEGORIAS.map(cat => {
              const meta  = FOLDER_META[cat] ?? { icon: "📁", color: "#64748b", bg: "#f8fafc" };
              const count = countMap[cat] ?? 0;
              return (
                <a
                  key={cat}
                  href={`/biblioteca?categoria=${encodeURIComponent(cat)}`}
                  style={{ textDecoration: "none" }}
                >
                  <div className="card" style={{
                    padding: "22px 16px",
                    textAlign: "center",
                    cursor: "pointer",
                    border: `1.5px solid ${count > 0 ? meta.color + "33" : "var(--border)"}`,
                    background: count > 0 ? meta.bg : "#fafbfc",
                    transition: "transform 0.1s, box-shadow 0.1s",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  }}>
                    <span style={{ fontSize: "2.8rem", lineHeight: 1 }}>{meta.icon}</span>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", color: count > 0 ? meta.color : "var(--muted)" }}>
                      {cat}
                    </div>
                    <div style={{
                      fontSize: "0.75rem", padding: "2px 10px", borderRadius: 999,
                      background: count > 0 ? `${meta.color}18` : "#f1f5f9",
                      color: count > 0 ? meta.color : "var(--muted)",
                      fontWeight: 700,
                    }}>
                      {count} {count === 1 ? "doc." : "docs."}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </>
      )}

      {/* ── Vista carpeta / búsqueda: documentos ── */}
      {vistaPlana && (
        <>
          {documentos.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>
              <div style={{ fontSize: "3rem", marginBottom: 12 }}>
                {enCarpeta ? (FOLDER_META[catFiltro]?.icon ?? "📁") : "🔍"}
              </div>
              <div style={{ fontWeight: 600 }}>
                {enCarpeta ? `Carpeta «${catFiltro}» vacía` : `Sin resultados para «${query}»`}
              </div>
              <div style={{ fontSize: "0.85rem", marginTop: 6 }}>
                Usá el botón "Subir documento" para agregar el primero.
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 14 }}>
                {documentos.length} documento{documentos.length !== 1 ? "s" : ""}
                {buscando && !enCarpeta && (
                  <span style={{ marginLeft: 8, fontSize: "0.78rem" }}>
                    — encontrados en {[...new Set(documentos.map(d => d.categoria))].join(", ")}
                  </span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                {documentos.map(doc => {
                  const meta = FOLDER_META[doc.categoria] ?? { icon: "📁", color: "#64748b", bg: "#f8fafc" };
                  return (
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

                      {/* Categoría + versión — solo mostrar categoría si buscamos en todas */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {!enCarpeta && (
                          <a
                            href={`/biblioteca?categoria=${encodeURIComponent(doc.categoria)}`}
                            style={{
                              display: "inline-block", padding: "2px 8px", borderRadius: 999,
                              fontSize: "0.73rem", fontWeight: 700, textDecoration: "none",
                              background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33`,
                            }}
                          >
                            {meta.icon} {doc.categoria}
                          </a>
                        )}
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

                      {/* Descripción */}
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

                      {/* Acciones */}
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
                        {esAdmin && <EliminarForm docId={doc.id} titulo={doc.titulo} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

    </AppShell>
  );
}

/* ─── Delete Form ─────────────────────────────────────────────────────── */
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
