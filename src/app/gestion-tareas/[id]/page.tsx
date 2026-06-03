import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireRole, canManageTareas, TAREAS_VER_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  agregarComentarioAction,
  cambiarEstadoTareaAction,
  reasignarTareaAction,
} from "@/app/gestion-tareas/actions";

// ─── helpers ─────────────────────────────────────────────────────────────────

const TIPO_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  tarea:          { label: "Tarea",             icon: "⚪", color: "#374151", bg: "#f1f5f9" },
  compromiso:     { label: "Compromiso",        icon: "🔵", color: "#1d4ed8", bg: "#dbeafe" },
  correctiva:     { label: "Acción correctiva", icon: "🟠", color: "#9a3412", bg: "#ffedd5" },
  preventiva:     { label: "Preventiva",        icon: "🟡", color: "#854d0e", bg: "#fef9c3" },
  mejora:         { label: "Mejora",            icon: "🟢", color: "#166534", bg: "#dcfce7" },
  urgente:        { label: "Urgente",           icon: "🔴", color: "#991b1b", bg: "#fee2e2" },
  administrativa: { label: "Administrativa",    icon: "⚫", color: "#374151", bg: "#f1f5f9" },
};

const ESTADO_META: Record<string, { label: string; color: string; bg: string }> = {
  pendiente:    { label: "Por hacer",     color: "#92400e", bg: "#fef3c7" },
  en_progreso:  { label: "En progreso",   color: "#1e40af", bg: "#dbeafe" },
  completada:   { label: "Completada",    color: "#166534", bg: "#dcfce7" },
  cancelada:    { label: "Cancelada",     color: "#64748b", bg: "#f1f5f9" },
};

function prioridadColor(p: string) {
  return p === "alta" ? "#dc2626" : p === "media" ? "#f97316" : "#16a34a";
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function hashColor(seed: string) {
  // Color pastel determinístico desde un string
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function fmtRelative(date: Date) {
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "hace unos segundos";
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `hace ${day}d`;
  return date.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtFullDateTime(date: Date) {
  return date.toLocaleString("es-CL", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({ name, size = 32 }: { name: string | null | undefined; size?: number }) {
  const txt = initials(name);
  const bg = hashColor(name ?? "?");
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        background: bg, color: "#fff",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: size * 0.4,
        flexShrink: 0,
      }}
      title={name ?? "Sin asignar"}
    >
      {txt}
    </div>
  );
}

// ─── Activity item types ─────────────────────────────────────────────────────

type ActivityItem =
  | { kind: "comment"; id: string; author: string; text: string; createdAt: Date }
  | { kind: "system"; id: string; action: string; actor: string | null; summary: string; createdAt: Date };

function systemIcon(action: string) {
  if (action === "TAREA_CREATE") return "✨";
  if (action === "TAREA_ESTADO") return "🔄";
  if (action === "TAREA_REASIGNAR") return "👤";
  if (action === "TAREA_UPDATE") return "✏️";
  return "📌";
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function TareaDetallePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string };
}) {
  const user = await requireRole(TAREAS_VER_ROLES);
  const puedeGestionar = canManageTareas(user.role);

  const tarea = await db.tarea.findUnique({ where: { id: params.id } });
  if (!tarea) notFound();

  // Privacidad: si es privada, solo el creador la ve
  if (tarea.esPrivada && tarea.creadoPor !== user.name && !puedeGestionar) {
    redirect("/gestion-tareas");
  }

  // Cargar comentarios y eventos del audit log en paralelo
  const [comentarios, auditEvents, usuarios] = await Promise.all([
    db.tareaComentario.findMany({ where: { tareaId: tarea.id }, orderBy: { createdAt: "asc" } }),
    db.auditLog.findMany({
      where: { entityType: "tarea", entityId: tarea.id, action: { notIn: ["TAREA_COMENTARIO"] } },
      orderBy: { createdAt: "asc" },
    }),
    puedeGestionar
      ? db.user.findMany({ where: { isActive: true, NOT: { email: { endsWith: "@nomade.local" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const activity: ActivityItem[] = [
    ...comentarios.map((c): ActivityItem => ({
      kind: "comment", id: c.id, author: c.autorNombre, text: c.texto, createdAt: c.createdAt,
    })),
    ...auditEvents.map((e): ActivityItem => ({
      kind: "system", id: e.id, action: e.action, actor: e.actorName, summary: e.summary, createdAt: e.createdAt,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const tipoMeta = TIPO_META[tarea.tipo] ?? TIPO_META.tarea;
  const estadoMeta = ESTADO_META[tarea.estado] ?? ESTADO_META.pendiente;
  const pColor = prioridadColor(tarea.prioridad);

  const diasAtraso = tarea.fechaCierre && !["completada", "cancelada"].includes(tarea.estado)
    ? Math.max(0, Math.floor((Date.now() - tarea.fechaCierre.getTime()) / 86400000))
    : 0;

  return (
    <AppShell
      title="Detalle de tarea"
      user={{ name: user.name, role: user.role }}
      activeNav="gestion-tareas"
      rightSlot={
        <Link href="/gestion-tareas">
          <button type="button" className="secondary">← Volver</button>
        </Link>
      }
    >
      <div className="page-stack" style={{ maxWidth: 1100, margin: "0 auto" }}>
        {searchParams?.status === "comentado" && (
          <div className="alert success">Comentario agregado.</div>
        )}

        {/* ── Header ── */}
        <div className="card" style={{ borderLeft: `5px solid ${pColor}` }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, background: estadoMeta.bg, color: estadoMeta.color }}>
                  {estadoMeta.label}
                </span>
                <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, background: tipoMeta.bg, color: tipoMeta.color }}>
                  {tipoMeta.icon} {tipoMeta.label}
                </span>
                <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, background: `${pColor}18`, color: pColor, textTransform: "uppercase" }}>
                  Prioridad {tarea.prioridad}
                </span>
                {tarea.esPrivada && (
                  <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, background: "#f3e8ff", color: "#7c3aed" }}>
                    🔒 Privada
                  </span>
                )}
                {diasAtraso > 0 && (
                  <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, background: "#fee2e2", color: "#dc2626" }}>
                    ⏰ {diasAtraso}d de atraso
                  </span>
                )}
              </div>
              <h2 style={{ margin: 0, fontSize: "1.4rem", color: "var(--text)", lineHeight: 1.3 }}>
                {tarea.descripcion}
              </h2>
            </div>

            {/* Quick state actions */}
            {puedeGestionar && !["completada", "cancelada"].includes(tarea.estado) && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {tarea.estado === "pendiente" && (
                  <form action={async () => { "use server"; await cambiarEstadoTareaAction(tarea.id, "en_progreso"); }}>
                    <button type="submit" className="secondary" style={{ fontSize: "0.82rem" }}>▶ Iniciar</button>
                  </form>
                )}
                <form action={async () => { "use server"; await cambiarEstadoTareaAction(tarea.id, "completada"); }}>
                  <button type="submit" style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem" }}>
                    ✓ Completar
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* ── Two-column body ── */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)", gap: 16, alignItems: "flex-start" }}>

          {/* ─── COLUMNA PRINCIPAL: Actividad + chat ─── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {tarea.comentario && (
              <div className="card">
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                  📝 Notas de creación
                </div>
                <div style={{ color: "var(--text)", lineHeight: 1.6, fontSize: "0.92rem", whiteSpace: "pre-wrap" }}>
                  {tarea.comentario}
                </div>
              </div>
            )}

            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                <h3 style={{ margin: 0, fontSize: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
                  💬 Actividad y seguimiento
                  <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 500 }}>({activity.length} eventos)</span>
                </h3>
              </div>

              <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14, maxHeight: 520, overflowY: "auto" }}>
                {activity.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: "0.88rem", textAlign: "center", padding: "20px 0" }}>
                    Aún no hay actividad. Sé el primero en comentar cómo va esta tarea.
                  </div>
                ) : (
                  activity.map((item) =>
                    item.kind === "comment" ? (
                      <div key={item.id} style={{ display: "flex", gap: 10 }}>
                        <Avatar name={item.author} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, color: "var(--text)", fontSize: "0.88rem" }}>{item.author}</span>
                            <span style={{ fontSize: "0.74rem", color: "var(--muted)" }} title={fmtFullDateTime(item.createdAt)}>
                              {fmtRelative(item.createdAt)}
                            </span>
                          </div>
                          <div style={{ background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", fontSize: "0.9rem", lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                            {item.text}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--muted)", fontSize: "0.82rem" }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f1f5f9", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.95rem", flexShrink: 0 }}>
                          {systemIcon(item.action)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600 }}>{item.actor ?? "Sistema"}</span> · {item.summary}
                          <span style={{ marginLeft: 8, fontSize: "0.74rem" }} title={fmtFullDateTime(item.createdAt)}>
                            {fmtRelative(item.createdAt)}
                          </span>
                        </div>
                      </div>
                    )
                  )
                )}
              </div>

              {/* Chat input */}
              <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border)", background: "#fafbfc" }}>
                <form action={async (fd: FormData) => {
                  "use server";
                  await agregarComentarioAction(tarea.id, fd);
                  redirect(`/gestion-tareas/${tarea.id}?status=comentado`);
                }} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <Avatar name={user.name} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      name="texto"
                      required
                      placeholder="Escribe un mensaje, pregunta cómo va, deja seguimiento…"
                      rows={2}
                      style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: "0.9rem", borderRadius: 10, border: "1px solid var(--border)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button type="submit" style={{ background: "var(--teal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: "0.88rem", fontWeight: 600, cursor: "pointer" }}>
                        💬 Comentar
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>

          {/* ─── SIDEBAR ─── */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 16 }}>
            <h3 style={{ margin: 0, fontSize: "1rem", borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>📋 Detalle</h3>

            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Responsable</div>
              {tarea.esPrivada ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar name={tarea.creadoPor ?? "—"} size={28} />
                  <span style={{ color: "var(--muted)", fontStyle: "italic", fontSize: "0.88rem" }}>Privada — solo {tarea.creadoPor ?? "el creador"}</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {tarea.responsable ? (
                    <>
                      <Avatar name={tarea.responsable} size={28} />
                      <span style={{ fontSize: "0.88rem" }}>{tarea.responsable}</span>
                    </>
                  ) : (
                    <span style={{ color: "var(--muted)", fontStyle: "italic", fontSize: "0.88rem" }}>Sin asignar</span>
                  )}
                </div>
              )}
              {puedeGestionar && !tarea.esPrivada && usuarios.length > 0 && (
                <form action={async (fd: FormData) => {
                  "use server";
                  const nuevo = String(fd.get("responsable") ?? "");
                  if (nuevo && nuevo !== tarea.responsable) {
                    await reasignarTareaAction(tarea.id, nuevo);
                  }
                }} style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <select name="responsable" defaultValue={tarea.responsable ?? ""} style={{ flex: 1, padding: "5px 8px", fontSize: "0.82rem" }}>
                    <option value="">— Sin asignar —</option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.name}>{u.name}</option>
                    ))}
                    {tarea.responsable && !usuarios.some(u => u.name === tarea.responsable) && (
                      <option value={tarea.responsable}>{tarea.responsable}</option>
                    )}
                  </select>
                  <button type="submit" className="secondary" style={{ padding: "5px 10px", fontSize: "0.78rem" }}>Guardar</button>
                </form>
              )}
            </div>

            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Fecha de cierre</div>
              <div style={{ fontSize: "0.88rem", color: diasAtraso > 0 ? "#dc2626" : "var(--text)", fontWeight: diasAtraso > 0 ? 700 : 500 }}>
                {tarea.fechaCierre
                  ? <>{tarea.fechaCierre.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })}{diasAtraso > 0 && ` · ${diasAtraso}d atraso`}</>
                  : <span style={{ color: "var(--muted)" }}>Sin fecha</span>}
              </div>
            </div>

            {tarea.fechaInicio && (
              <div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Fecha de inicio</div>
                <div style={{ fontSize: "0.88rem" }}>{tarea.fechaInicio.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })}</div>
              </div>
            )}

            {tarea.fechaCompletada && (
              <div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Completada el</div>
                <div style={{ fontSize: "0.88rem", color: "#16a34a", fontWeight: 600 }}>
                  ✓ {tarea.fechaCompletada.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })}
                </div>
              </div>
            )}

            {(tarea.proyecto || tarea.area) && (
              <div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Proyecto / área</div>
                <div style={{ fontSize: "0.88rem" }}>
                  {tarea.proyecto && <div>📌 {tarea.proyecto}</div>}
                  {tarea.area && <div style={{ color: "var(--muted)" }}>{tarea.area}</div>}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Creada por</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar name={tarea.creadoPor ?? "—"} size={28} />
                <div>
                  <div style={{ fontSize: "0.88rem" }}>{tarea.creadoPor ?? "Sistema"}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--muted)" }} title={fmtFullDateTime(tarea.createdAt)}>
                    {fmtRelative(tarea.createdAt)}
                  </div>
                </div>
              </div>
            </div>

            {/* State change buttons */}
            {puedeGestionar && (
              <div style={{ paddingTop: 8, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Cambiar estado</div>
                {["pendiente", "en_progreso", "completada", "cancelada"].filter((e) => e !== tarea.estado).map((e) => {
                  const meta = ESTADO_META[e];
                  return (
                    <form key={e} action={async () => { "use server"; await cambiarEstadoTareaAction(tarea.id, e); }}>
                      <button type="submit" style={{ width: "100%", padding: "6px 10px", fontSize: "0.82rem", background: meta.bg, color: meta.color, border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                        → {meta.label}
                      </button>
                    </form>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
