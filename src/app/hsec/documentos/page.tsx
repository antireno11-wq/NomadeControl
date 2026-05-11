import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole, HSEC_ROLES, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { createDocumentoHSECAction, deleteDocumentoHSECAction } from "./actions";

type SearchParams = { campId?: string; status?: string };

/* ─── Document types ──────────────────────────────────────────────── */
const TIPOS_DOC: { value: string; label: string }[] = [
  { value: "plan_emergencia",       label: "Plan de emergencia" },
  { value: "prevencion_riesgos",    label: "Plan prevención de riesgos" },
  { value: "reglamento_hsec",       label: "Reglamento interno HSEC" },
  { value: "autorizacion_sanitaria",label: "Autorización sanitaria" },
  { value: "permiso_edificacion",   label: "Permiso de edificación" },
  { value: "resolucion_salud",      label: "Resolución servicio de salud" },
  { value: "cert_instalaciones",    label: "Certificado de instalaciones" },
  { value: "permiso_municipal",     label: "Permiso municipal / sectorial" },
  { value: "contrato_servicio",     label: "Contrato de servicio" },
  { value: "documento_legal",       label: "Documento legal empresa" },
  { value: "otro",                  label: "Otro" },
];

const TIPO_LABEL: Record<string, string> = Object.fromEntries(
  TIPOS_DOC.map((t) => [t.value, t.label])
);

/* ─── Status banner ───────────────────────────────────────────────── */
function statusMsg(s?: string) {
  if (s === "created") return { type: "success", text: "Documento subido correctamente." };
  if (s === "deleted") return { type: "success", text: "Documento eliminado." };
  if (s === "invalid") return { type: "error",   text: "Faltan campos obligatorios." };
  return null;
}

/* ─── Expiry badge ────────────────────────────────────────────────── */
function expiryBadge(fecha: Date | null) {
  if (!fecha) return null;
  const now = new Date();
  const diffMs = fecha.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let bg: string;
  let color: string;
  let label: string;

  if (diffDays < 0) {
    bg = "#fee2e2"; color = "#dc2626"; label = "Vencido";
  } else if (diffDays <= 7) {
    bg = "#fce7e7"; color = "#c0392b"; label = `${diffDays}d`;
  } else if (diffDays <= 30) {
    bg = "#fff3e0"; color = "#e65100"; label = `${diffDays}d`;
  } else if (diffDays <= 60) {
    bg = "#fffde7"; color = "#f57f17"; label = `${diffDays}d`;
  } else {
    bg = "#dcfce7"; color = "#16a34a"; label = fecha.toLocaleDateString("es-CL");
  }

  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: "0.78rem", fontWeight: 700, background: bg, color,
    }}>
      {label}
    </span>
  );
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

/* ─── Page ────────────────────────────────────────────────────────── */
export default async function DocumentosHSECPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const user = await requireRole(HSEC_ROLES);
  const isAdmin = isAdminRole(user.role);
  const msg = statusMsg(searchParams?.status);

  // Fetch all active camps
  const camps = await db.camp.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  // Determine which camp is selected
  let selectedCampId: string | undefined;
  if (!isAdmin && user.campId) {
    // Non-admins are always scoped to their own camp
    selectedCampId = user.campId;
  } else {
    // Admins: use searchParam or fall back to first camp
    selectedCampId = searchParams?.campId ?? camps[0]?.id;
  }

  // Fetch documents for selected camp
  const documentos = selectedCampId
    ? await db.documentoHSEC.findMany({
        where: { campId: selectedCampId },
        orderBy: { createdAt: "desc" },
        include: { camp: { select: { name: true } } },
      })
    : [];

  const selectedCamp = camps.find((c) => c.id === selectedCampId);

  return (
    <AppShell
      title="Documentos HSEC"
      user={user}
      activeNav="hsec"
      rightSlot={
        <Link
          href="/hsec"
          style={{
            padding: "7px 16px", borderRadius: 8,
            background: "var(--card-bg, #fff)", border: "1px solid var(--border)",
            fontWeight: 600, fontSize: "0.88rem", textDecoration: "none",
            color: "var(--fg)",
          }}
        >
          ← Volver
        </Link>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Status banner */}
        {msg && (
          <div style={{
            padding: "10px 14px", borderRadius: 10, fontWeight: 600,
            background: msg.type === "success" ? "#dcfce7" : "#fee2e2",
            color: msg.type === "success" ? "#15803d" : "#dc2626",
          }}>
            {msg.text}
          </div>
        )}

        {/* Camp selector — admin only */}
        {isAdmin && camps.length > 0 && (
          <div className="card" style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--muted)" }}>
                Campamento:
              </span>
              {camps.map((c) => (
                <Link
                  key={c.id}
                  href={`/hsec/documentos?campId=${c.id}`}
                  style={{
                    padding: "4px 14px", borderRadius: 999, fontSize: "0.85rem",
                    fontWeight: c.id === selectedCampId ? 700 : 500,
                    textDecoration: "none",
                    background: c.id === selectedCampId ? "var(--teal, #0d9488)" : "var(--card-bg, #f8fafc)",
                    color: c.id === selectedCampId ? "#fff" : "var(--fg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* No camps at all */}
        {camps.length === 0 && (
          <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            No hay campamentos activos registrados.
          </div>
        )}

        {/* Main two-column layout */}
        {selectedCampId && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,420px) 1fr", gap: "1.25rem", alignItems: "start" }}>

            {/* ── Upload form ── */}
            <div className="card" style={{ padding: "1.25rem" }}>
              <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.05rem", color: "var(--teal, #0d9488)" }}>
                Subir documento
              </h2>
              {selectedCamp && (
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
                  Campamento: <strong>{selectedCamp.name}</strong>
                </div>
              )}
              <form
                action={createDocumentoHSECAction}
                encType="multipart/form-data"
                style={{ display: "grid", gap: "0.75rem" }}
              >
                <input type="hidden" name="campId" value={selectedCampId} />

                {/* tipo */}
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
                    Tipo de documento *
                  </label>
                  <select name="tipo" required style={{ padding: "7px 10px", width: "100%" }}>
                    <option value="">— Seleccionar —</option>
                    {TIPOS_DOC.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* nombre */}
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
                    Nombre *
                  </label>
                  <input
                    name="nombre"
                    required
                    placeholder="Ej: Plan de emergencias 2024"
                    style={{ padding: "7px 10px", width: "100%" }}
                  />
                </div>

                {/* dates */}
                <div className="grid two" style={{ gap: "0.6rem" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
                      Fecha emisión
                    </label>
                    <input type="date" name="fechaEmision" style={{ padding: "7px 10px", width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
                      ⚠️ Fecha vencimiento
                    </label>
                    <input type="date" name="fechaVencimiento" style={{ padding: "7px 10px", width: "100%" }} />
                  </div>
                </div>

                {/* responsable */}
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
                    Responsable
                  </label>
                  <input
                    name="responsable"
                    placeholder="Nombre del responsable"
                    style={{ padding: "7px 10px", width: "100%" }}
                  />
                </div>

                {/* notas */}
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
                    Notas
                  </label>
                  <textarea
                    name="notas"
                    rows={2}
                    placeholder="Observaciones opcionales"
                    style={{ padding: "7px 10px", width: "100%", resize: "vertical" }}
                  />
                </div>

                {/* file */}
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>
                    Archivo (PDF o imagen)
                  </label>
                  <input
                    type="file"
                    name="file"
                    accept=".pdf,image/*"
                    style={{ padding: "6px 0", fontSize: "0.85rem", width: "100%" }}
                  />
                </div>

                <button type="submit" style={{ padding: "9px 0", borderRadius: 8, marginTop: 4 }}>
                  Subir documento
                </button>
              </form>
            </div>

            {/* ── Documents list ── */}
            <div className="card" style={{ padding: "1.25rem", overflowX: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
                  Documentos del campamento
                  {selectedCamp && (
                    <span style={{ marginLeft: 8, fontSize: "0.85rem", fontWeight: 400, color: "var(--muted)" }}>
                      — {selectedCamp.name}
                    </span>
                  )}
                </h2>
                <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                  {documentos.length} {documentos.length === 1 ? "documento" : "documentos"}
                </span>
              </div>

              {documentos.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--muted)" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📂</div>
                  <div style={{ fontWeight: 600 }}>No hay documentos cargados para este campamento.</div>
                  <div style={{ fontSize: "0.82rem", marginTop: 4 }}>
                    Usá el formulario de la izquierda para subir el primero.
                  </div>
                </div>
              ) : (
                <table style={{ width: "100%", fontSize: "0.85rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Tipo</th>
                      <th style={{ textAlign: "left" }}>Nombre</th>
                      <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Responsable</th>
                      <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Emisión</th>
                      <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Vencimiento</th>
                      <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>Archivo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {documentos.map((doc) => (
                      <tr key={doc.id}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <span style={{
                            display: "inline-block", padding: "2px 8px", borderRadius: 4,
                            fontSize: "0.75rem", fontWeight: 700,
                            background: "var(--teal, #0d9488)22",
                            color: "var(--teal, #0d9488)",
                          }}>
                            {TIPO_LABEL[doc.tipo] ?? doc.tipo}
                          </span>
                        </td>
                        <td style={{ maxWidth: 240, wordBreak: "break-word" }}>{doc.nombre}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{doc.responsable ?? "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(doc.fechaEmision)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {doc.fechaVencimiento
                            ? expiryBadge(doc.fechaVencimiento)
                            : <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                        <td>
                          {doc.contenido ? (
                            <a
                              href={`/hsec/documentos/${doc.id}/download`}
                              style={{
                                padding: "4px 10px", borderRadius: 6,
                                background: "var(--teal, #0d9488)", color: "#fff",
                                fontWeight: 700, fontSize: "0.78rem",
                                textDecoration: "none", whiteSpace: "nowrap",
                              }}
                            >
                              ↓ Descargar
                            </a>
                          ) : (
                            <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>Sin archivo</span>
                          )}
                        </td>
                        <td>
                          <DeleteDocForm docId={doc.id} nombre={doc.nombre} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ─── Delete form ─────────────────────────────────────────────────── */
function DeleteDocForm({ docId, nombre }: { docId: string; nombre: string }) {
  return (
    <form action={deleteDocumentoHSECAction}>
      <input type="hidden" name="docId" value={docId} />
      <button
        type="submit"
        title={`Eliminar «${nombre}»`}
        style={{
          width: "auto", padding: "4px 10px", borderRadius: 6,
          background: "#fee2e2", color: "#dc2626", fontWeight: 700,
          fontSize: "0.78rem", border: "1px solid #fca5a5", cursor: "pointer",
        }}
      >
        🗑
      </button>
    </form>
  );
}
