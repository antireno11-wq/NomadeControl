import { AppShell } from "@/components/app-shell";
import { requireRole, TAREAS_ROLES, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { crearTareaAction, editarTareaAction, eliminarTareaAction, cambiarEstadoTareaAction, reasignarTareaAction } from "./actions";

type SearchParams = { status?: string; filtro?: string; ver?: string };

function statusMsg(s?: string) {
  if (s === "created") return { type: "success", text: "Tarea creada correctamente." };
  if (s === "updated") return { type: "success", text: "Tarea actualizada correctamente." };
  if (s === "invalid") return { type: "error", text: "Revisá los datos ingresados." };
  return null;
}

function prioridadBadge(p: string) {
  const map: Record<string, string> = { alta: "#dc2626", media: "#f97316", baja: "#16a34a" };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:700;background:${map[p] ?? "#94a3b8"}22;color:${map[p] ?? "#64748b"}">${p.toUpperCase()}</span>`;
}

function estadoBadge(e: string) {
  const map: Record<string, [string, string]> = {
    pendiente:   ["#f59e0b", "Pendiente"],
    en_progreso: ["#3b82f6", "En progreso"],
    completada:  ["#16a34a", "Completada"],
    cancelada:   ["#94a3b8", "Cancelada"],
  };
  const [color, label] = map[e] ?? ["#94a3b8", e];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:700;background:${color}22;color:${color}">${label}</span>`;
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function diasAtraso(fechaCierre: Date | null, estado: string) {
  if (!fechaCierre || ["completada", "cancelada"].includes(estado)) return 0;
  const diff = Math.floor((Date.now() - fechaCierre.getTime()) / 86400000);
  return Math.max(0, diff);
}

export default async function GestionTareasPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(TAREAS_ROLES);
  const msg = statusMsg(searchParams?.status);
  const verCompletadas = searchParams?.ver === "todas";
  const filtroResp = searchParams?.filtro ?? "";

  const [tareas, usuarios] = await Promise.all([
    db.tarea.findMany({
      where: verCompletadas ? undefined : { estado: { notIn: ["completada", "cancelada"] } },
      orderBy: [{ fechaCierre: "asc" }, { createdAt: "desc" }],
    }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const tareasFiltradas = filtroResp
    ? tareas.filter(t => t.responsable === filtroResp)
    : tareas;

  const stats = {
    total:      tareas.length,
    pendientes: tareas.filter(t => t.estado === "pendiente").length,
    enProgreso: tareas.filter(t => t.estado === "en_progreso").length,
    atrasadas:  tareas.filter(t => diasAtraso(t.fechaCierre, t.estado) > 0).length,
    completadas: tareas.filter(t => t.estado === "completada").length,
  };

  return (
    <AppShell title="Gestión de Tareas" user={{ name: user.name, role: user.role }} activeNav="gestion-tareas">
      {msg && (
        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: msg.type === "success" ? "#dcfce7" : "#fee2e2", color: msg.type === "success" ? "#15803d" : "#dc2626", fontWeight: 600 }}>
          {msg.text}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total", value: stats.total, color: "#006878" },
          { label: "Pendientes", value: stats.pendientes, color: "#f59e0b" },
          { label: "En progreso", value: stats.enProgreso, color: "#3b82f6" },
          { label: "Atrasadas", value: stats.atrasadas, color: "#dc2626" },
          { label: "Completadas", value: stats.completadas, color: "#16a34a" },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: "center", padding: "14px 10px" }}>
            <div style={{ fontSize: "1.8rem", fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <form method="GET" style={{ display: "contents" }}>
          <select name="filtro" defaultValue={filtroResp} onChange={undefined}
            style={{ width: "auto", padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.9rem" }}>
            <option value="">Todos los responsables</option>
            {usuarios.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
          {verCompletadas && <input type="hidden" name="ver" value="todas" />}
          <button type="submit" style={{ width: "auto", padding: "7px 16px", borderRadius: 8 }}>Filtrar</button>
        </form>
        <a href={verCompletadas ? "/gestion-tareas" : "/gestion-tareas?ver=todas"}
          style={{ padding: "7px 14px", borderRadius: 8, background: verCompletadas ? "#16a34a22" : "#f1f5f9", color: verCompletadas ? "#15803d" : "var(--muted)", fontWeight: 600, fontSize: "0.88rem", textDecoration: "none", border: "1px solid var(--border)" }}>
          {verCompletadas ? "🙈 Ocultar completadas" : "👁 Ver completadas"}
        </a>
        <details style={{ marginLeft: "auto" }}>
          <summary style={{ cursor: "pointer", padding: "7px 16px", borderRadius: 8, background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: "0.9rem", listStyle: "none", display: "inline-block" }}>
            + Nueva tarea
          </summary>
          <div className="card" style={{ position: "absolute", zIndex: 100, minWidth: 400, marginTop: 6, right: 24 }}>
            <TareaForm usuarios={usuarios} />
          </div>
        </details>
      </div>

      {/* Tabla */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Descripción</th>
              <th>Tipo</th>
              <th>Responsable</th>
              <th>Prioridad</th>
              <th>Cierre</th>
              <th>Atraso</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tareasFiltradas.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>No hay tareas con estos filtros</td></tr>
            ) : tareasFiltradas.map(t => {
              const atraso = diasAtraso(t.fechaCierre, t.estado);
              const terminada = ["completada", "cancelada"].includes(t.estado);
              return (
                <tr key={t.id} style={{ opacity: terminada ? 0.6 : 1 }}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", textDecoration: terminada ? "line-through" : "none" }}>{t.descripcion}</div>
                    {t.proyecto && <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>📌 {t.proyecto}{t.area ? ` · ${t.area}` : ""}</div>}
                    {t.comentario && <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{t.comentario}</div>}
                  </td>
                  <td style={{ fontSize: "0.82rem" }}>{t.tipo}</td>
                  <td style={{ fontSize: "0.85rem", fontWeight: 600 }}>{t.responsable ?? "—"}</td>
                  <td dangerouslySetInnerHTML={{ __html: prioridadBadge(t.prioridad) }} />
                  <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{fmtDate(t.fechaCierre)}</td>
                  <td>
                    {atraso > 0
                      ? <span style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.82rem" }}>{atraso}d</span>
                      : <span style={{ color: "#16a34a", fontSize: "0.82rem" }}>Al día</span>}
                  </td>
                  <td dangerouslySetInnerHTML={{ __html: estadoBadge(t.estado) }} />
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {!terminada && (
                        <form action={async () => { "use server"; await cambiarEstadoTareaAction(t.id, "completada"); }}>
                          <button type="submit" style={{ width: "auto", padding: "4px 10px", fontSize: "0.8rem", borderRadius: 6, background: "#16a34a" }}>✓</button>
                        </form>
                      )}
                      <details style={{ position: "relative" }}>
                        <summary style={{ cursor: "pointer", padding: "4px 10px", borderRadius: 6, background: "#334e5c", color: "#fff", fontWeight: 600, fontSize: "0.8rem", listStyle: "none", display: "inline-block" }}>✏️</summary>
                        <div className="card" style={{ position: "absolute", right: 0, zIndex: 200, minWidth: 360, marginTop: 4 }}>
                          <TareaForm tarea={t} usuarios={usuarios} />
                        </div>
                      </details>
                      <ReasignarForm tareaId={t.id} usuarios={usuarios} responsableActual={t.responsable} />
                      <EliminarForm tareaId={t.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function TareaForm({ tarea, usuarios }: {
  tarea?: { id: string; tipo: string; proyecto: string | null; area: string | null; descripcion: string; responsable: string | null; comentario: string | null; prioridad: string; estado: string; fechaInicio: Date | null; fechaCierre: Date | null };
  usuarios: { id: string; name: string }[];
}) {
  const isEdit = !!tarea;
  const action = isEdit
    ? editarTareaAction.bind(null, tarea!.id)
    : crearTareaAction;

  return (
    <form action={action} style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--teal)" }}>{isEdit ? "Editar tarea" : "Nueva tarea"}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Tipo</label>
          <select name="tipo" defaultValue={tarea?.tipo ?? "compromiso"} style={{ padding: "7px 10px" }}>
            <option value="compromiso">Compromiso</option>
            <option value="amenaza">Amenaza</option>
            <option value="rdp">Registro de Pendientes</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Prioridad</label>
          <select name="prioridad" defaultValue={tarea?.prioridad ?? "media"} style={{ padding: "7px 10px" }}>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </div>
      </div>
      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Descripción *</label>
        <textarea name="descripcion" defaultValue={tarea?.descripcion} required style={{ minHeight: 70, padding: "7px 10px" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Proyecto</label>
          <input name="proyecto" defaultValue={tarea?.proyecto ?? ""} style={{ padding: "7px 10px" }} />
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Área</label>
          <input name="area" defaultValue={tarea?.area ?? ""} style={{ padding: "7px 10px" }} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Responsable</label>
        <select name="responsable" defaultValue={tarea?.responsable ?? ""} style={{ padding: "7px 10px" }}>
          <option value="">— Sin asignar —</option>
          {usuarios.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Fecha inicio</label>
          <input type="date" name="fechaInicio" defaultValue={tarea?.fechaInicio?.toISOString().slice(0, 10) ?? ""} style={{ padding: "7px 10px" }} />
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Fecha cierre</label>
          <input type="date" name="fechaCierre" defaultValue={tarea?.fechaCierre?.toISOString().slice(0, 10) ?? ""} style={{ padding: "7px 10px" }} />
        </div>
      </div>
      {isEdit && (
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Estado</label>
          <select name="estado" defaultValue={tarea?.estado} style={{ padding: "7px 10px" }}>
            <option value="pendiente">Pendiente</option>
            <option value="en_progreso">En progreso</option>
            <option value="completada">Completada</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </div>
      )}
      {!isEdit && <input type="hidden" name="estado" value="pendiente" />}
      <div>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Comentario</label>
        <textarea name="comentario" defaultValue={tarea?.comentario ?? ""} style={{ minHeight: 50, padding: "7px 10px" }} />
      </div>
      <button type="submit" style={{ padding: "9px 0", borderRadius: 8 }}>
        {isEdit ? "Guardar cambios" : "Crear tarea"}
      </button>
    </form>
  );
}

function ReasignarForm({ tareaId, usuarios, responsableActual }: { tareaId: string; usuarios: { id: string; name: string }[]; responsableActual: string | null }) {
  return (
    <details style={{ position: "relative" }}>
      <summary style={{ cursor: "pointer", padding: "4px 10px", borderRadius: 6, background: "#e2e8f0", color: "#334e5c", fontWeight: 600, fontSize: "0.8rem", listStyle: "none", display: "inline-block" }}>🔄</summary>
      <div className="card" style={{ position: "absolute", right: 0, zIndex: 200, minWidth: 260, marginTop: 4 }}>
        <p style={{ margin: "0 0 8px", fontSize: "0.85rem", color: "var(--muted)" }}>
          Actualmente: <strong>{responsableActual ?? "—"}</strong>
        </p>
        <form action={async (fd: FormData) => { "use server"; await reasignarTareaAction(tareaId, fd.get("responsable") as string); }} style={{ display: "grid", gap: 8 }}>
          <select name="responsable" style={{ padding: "7px 10px" }}>
            <option value="">— Sin asignar —</option>
            {usuarios.filter(u => u.name !== responsableActual).map(u => (
              <option key={u.id} value={u.name}>{u.name}</option>
            ))}
          </select>
          <button type="submit" style={{ padding: "7px 0", borderRadius: 8, fontSize: "0.85rem" }}>Reasignar</button>
        </form>
      </div>
    </details>
  );
}

function EliminarForm({ tareaId }: { tareaId: string }) {
  return (
    <form action={async () => { "use server"; await eliminarTareaAction(tareaId); }}>
      <button type="submit" className="danger" style={{ width: "auto", padding: "4px 10px", fontSize: "0.8rem", borderRadius: 6 }}
        onClick={undefined}>🗑</button>
    </form>
  );
}
