import { AppShell } from "@/components/app-shell";
import { requireRole, canManageTareas, TAREAS_VER_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  crearTareaAction,
  editarTareaAction,
  eliminarTareaAction,
  cambiarEstadoTareaAction,
  reasignarTareaAction,
  agregarComentarioAction,
} from "./actions";

// ─── helpers ────────────────────────────────────────────────────────────────

type SearchParams = { v?: string; filtro?: string; ver?: string; status?: string };

function prioridadColor(p: string) {
  return p === "alta" ? "#dc2626" : p === "media" ? "#f97316" : "#16a34a";
}

function estadoColor(e: string) {
  const map: Record<string, string> = {
    pendiente: "#f59e0b",
    en_progreso: "#3b82f6",
    completada: "#16a34a",
    cancelada: "#94a3b8",
  };
  return map[e] ?? "#94a3b8";
}

function estadoLabel(e: string) {
  const map: Record<string, string> = {
    pendiente: "Por hacer",
    en_progreso: "En progreso",
    completada: "Completada",
    cancelada: "Cancelada",
  };
  return map[e] ?? e;
}

function fmtDate(d: Date | null) {
  if (!d) return null;
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
}

function diasAtraso(fechaCierre: Date | null, estado: string) {
  if (!fechaCierre || ["completada", "cancelada"].includes(estado)) return 0;
  return Math.max(0, Math.floor((Date.now() - fechaCierre.getTime()) / 86400000));
}

function statusMsg(s?: string) {
  if (s === "created") return { type: "success", text: "Tarea creada correctamente." };
  if (s === "updated") return { type: "success", text: "Tarea actualizada correctamente." };
  if (s === "invalid") return { type: "error", text: "Revisá los datos ingresados." };
  return null;
}

// ─── page ────────────────────────────────────────────────────────────────────

export default async function GestionTareasPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(TAREAS_VER_ROLES);
  const puedeGestionar = canManageTareas(user.role);
  const esColaborador = user.role === "COLABORADOR";

  const vista = (esColaborador ? "mis" : searchParams?.v) ?? "mis";
  const verCompletadas = searchParams?.ver === "todas";
  const filtroResp = esColaborador ? user.name : (searchParams?.filtro ?? "");
  const msg = statusMsg(searchParams?.status);

  // Tareas
  const whereBase = verCompletadas
    ? {}
    : { estado: { notIn: ["completada", "cancelada"] } };

  const whereFiltro = filtroResp
    ? { ...whereBase, responsable: filtroResp }
    : whereBase;

  const [tareas, usuarios, proyectos, areas] = await Promise.all([
    db.tarea.findMany({
      where: whereFiltro,
      orderBy: [{ fechaCierre: "asc" }, { createdAt: "desc" }],
    }),
    puedeGestionar
      ? db.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([] as { id: string; name: string }[]),
    (db as any).proyectoConfig.findMany({ where: { isActive: true }, orderBy: { nombre: "asc" } }),
    (db as any).areaConfig.findMany({ where: { isActive: true }, orderBy: { nombre: "asc" } }),
  ]);

  const usuariosList = usuarios as { id: string; name: string }[];
  const proyectosList = proyectos.map(p => p.nombre);
  const areasList = areas.map(a => a.nombre);

  // Fetch extra data in parallel based on the current view
  const tareasTodas = (!esColaborador && (vista === "todas" || vista === "tablero" || vista === "gantt"))
    ? await db.tarea.findMany({ where: verCompletadas ? {} : { estado: { notIn: ["completada", "cancelada"] } } })
    : tareas;

  const misTareasBase = (vista === "mis" || esColaborador)
    ? await db.tarea.findMany({
        where: { responsable: user.name },
        orderBy: [{ fechaCierre: "asc" }, { createdAt: "desc" }],
      })
    : [];

  // Fetch comments separately to avoid Prisma include complexity
  const tareaIds = misTareasBase.map(t => t.id);
  const comentariosList = tareaIds.length > 0
    ? await (db as any).tareaComentario.findMany({
        where: { tareaId: { in: tareaIds } },
        orderBy: { createdAt: "asc" },
      }).catch(() => [])
    : [];

  const comentariosByTareaId = (comentariosList as any[]).reduce((acc: Record<string, any[]>, c: any) => {
    if (!acc[c.tareaId]) acc[c.tareaId] = [];
    acc[c.tareaId].push(c);
    return acc;
  }, {});

  const misTareas: TareaRow[] = misTareasBase.map(t => ({
    ...t,
    comentarios: comentariosByTareaId[t.id] ?? [],
  }));

  const stats = {
    total: tareasTodas.length,
    pendientes: tareasTodas.filter(t => t.estado === "pendiente").length,
    enProgreso: tareasTodas.filter(t => t.estado === "en_progreso").length,
    atrasadas: tareasTodas.filter(t => diasAtraso(t.fechaCierre, t.estado) > 0).length,
    completadas: tareasTodas.filter(t => t.estado === "completada").length,
  };

  return (
    <AppShell title="Gestión de Tareas" user={{ name: user.name, role: user.role }} activeNav="gestion-tareas">

      {/* Flash */}
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

      {/* Tab bar + new task button */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flex: 1, flexWrap: "wrap" }}>
          <TabLink href="/gestion-tareas?v=mis" active={vista === "mis"}>📋 Mis tareas</TabLink>
          {!esColaborador && (
            <TabLink href="/gestion-tareas?v=todas" active={vista === "todas"}>📊 Todas las tareas</TabLink>
          )}
          {!esColaborador && (
            <TabLink href="/gestion-tareas?v=tablero" active={vista === "tablero"}>🗂 Tablero</TabLink>
          )}
          {!esColaborador && (
            <TabLink href="/gestion-tareas?v=gantt" active={vista === "gantt"}>📅 Gantt</TabLink>
          )}
        </div>

        {puedeGestionar && (
          <details style={{ position: "relative" }}>
            <summary style={{
              cursor: "pointer", padding: "8px 18px", borderRadius: 8,
              background: "var(--accent)", color: "#fff", fontWeight: 700,
              fontSize: "0.92rem", listStyle: "none", display: "inline-block",
              userSelect: "none",
            }}>
              + Nueva tarea
            </summary>
            <div className="card" style={{ position: "absolute", right: 0, zIndex: 200, minWidth: 420, marginTop: 6 }}>
              <TareaForm usuarios={usuariosList} proyectos={proyectosList} areas={areasList} />
            </div>
          </details>
        )}
      </div>

      {/* Views */}
      {vista === "mis" && (
        <MisTareasView
          tareas={misTareas}
          usuarios={usuariosList}
          proyectos={proyectosList}
          areas={areasList}
          puedeGestionar={puedeGestionar}
          userName={user.name}
        />
      )}

      {vista === "todas" && !esColaborador && (
        <TodasTareasView
          tareas={tareas}
          usuarios={usuariosList}
          proyectos={proyectosList}
          areas={areasList}
          stats={stats}
          filtroResp={filtroResp}
          verCompletadas={verCompletadas}
          puedeGestionar={puedeGestionar}
        />
      )}

      {vista === "tablero" && !esColaborador && (
        <TableroView
          tareas={tareas}
          usuarios={usuariosList}
          proyectos={proyectosList}
          areas={areasList}
          puedeGestionar={puedeGestionar}
        />
      )}

      {vista === "gantt" && !esColaborador && (
        <GanttView tareas={tareasTodas} />
      )}

      {esColaborador && vista !== "mis" && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          Vista no disponible para tu rol.
        </div>
      )}
    </AppShell>
  );
}

// ─── Tab link ─────────────────────────────────────────────────────────────────

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a href={href} style={{
      padding: "7px 16px", borderRadius: 999,
      background: active ? "var(--teal)" : "transparent",
      color: active ? "#fff" : "var(--muted)",
      fontWeight: 600, fontSize: "0.88rem", textDecoration: "none",
      border: active ? "1.5px solid var(--teal)" : "1.5px solid var(--border)",
      transition: "background 0.15s",
    }}>
      {children}
    </a>
  );
}

// ─── Tarea row (Asana-style) ──────────────────────────────────────────────────

type TareaComentarioRow = {
  id: string;
  texto: string;
  autorNombre: string;
  createdAt: Date;
};

type TareaRow = {
  id: string;
  descripcion: string;
  tipo: string;
  proyecto: string | null;
  area: string | null;
  responsable: string | null;
  prioridad: string;
  estado: string;
  fechaCierre: Date | null;
  comentario: string | null;
  fechaInicio: Date | null;
  comentarios?: TareaComentarioRow[];
};

function AsanaTareaRow({
  t,
  usuarios,
  proyectos,
  areas,
  puedeGestionar,
}: {
  t: TareaRow;
  usuarios: { id: string; name: string }[];
  proyectos: string[];
  areas: string[];
  puedeGestionar: boolean;
}) {
  const terminada = ["completada", "cancelada"].includes(t.estado);
  const atraso = diasAtraso(t.fechaCierre, t.estado);
  const fecha = fmtDate(t.fechaCierre);
  const pColor = prioridadColor(t.prioridad);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px", borderBottom: "1px solid var(--border)",
      background: terminada ? "#f8fafc" : "#fff",
      opacity: terminada ? 0.7 : 1,
      borderLeft: `4px solid ${pColor}`,
    }}>
      {/* Complete button */}
      <div style={{ flexShrink: 0 }}>
        {terminada ? (
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: "50%",
            background: "#16a34a22", color: "#16a34a", fontWeight: 800, fontSize: "0.8rem",
          }}>✓</span>
        ) : puedeGestionar ? (
          <form action={async () => { "use server"; await cambiarEstadoTareaAction(t.id, "completada"); }}>
            <button type="submit" title="Marcar completada" style={{
              width: 22, height: 22, borderRadius: "50%", padding: 0,
              background: "transparent", border: "2px solid #cbd5e1",
              cursor: "pointer", color: "#94a3b8", fontSize: "0.75rem", lineHeight: 1,
            }}>○</button>
          </form>
        ) : (
          <span style={{
            display: "inline-block", width: 22, height: 22, borderRadius: "50%",
            border: "2px solid #cbd5e1",
          }} />
        )}
      </div>

      {/* Description + tags */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 600, fontSize: "0.9rem",
          textDecoration: terminada ? "line-through" : "none",
          color: terminada ? "var(--muted)" : "inherit",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {t.descripcion}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
          {t.proyecto && (
            <span style={{
              fontSize: "0.72rem", padding: "1px 7px", borderRadius: 999,
              background: "#e0f2fe", color: "#0369a1", fontWeight: 600,
            }}>
              📌 {t.proyecto}{t.area ? ` · ${t.area}` : ""}
            </span>
          )}
          <span style={{
            fontSize: "0.72rem", padding: "1px 7px", borderRadius: 999,
            background: `${pColor}18`, color: pColor, fontWeight: 700, textTransform: "uppercase",
          }}>
            {t.prioridad}
          </span>
        </div>
      </div>

      {/* Due date */}
      <div style={{ flexShrink: 0, fontSize: "0.8rem", minWidth: 80, textAlign: "right" }}>
        {fecha ? (
          atraso > 0 ? (
            <span style={{ color: "#dc2626", fontWeight: 700 }}>{fecha} · {atraso}d</span>
          ) : (
            <span style={{ color: "var(--muted)" }}>{fecha}</span>
          )
        ) : (
          <span style={{ color: "var(--border)" }}>—</span>
        )}
      </div>

      {/* Responsable */}
      <div style={{
        flexShrink: 0, fontSize: "0.8rem", color: "var(--muted)",
        minWidth: 90, maxWidth: 120, overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {t.responsable ?? <span style={{ color: "var(--border)" }}>—</span>}
      </div>

      {/* Actions */}
      {puedeGestionar && (
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <details style={{ position: "relative" }}>
            <summary style={{
              cursor: "pointer", padding: "3px 9px", borderRadius: 6,
              background: "#334e5c", color: "#fff", fontWeight: 600,
              fontSize: "0.78rem", listStyle: "none", display: "inline-block",
            }}>✏️</summary>
            <div className="card" style={{ position: "absolute", right: 0, zIndex: 200, minWidth: 380, marginTop: 4 }}>
              <TareaForm tarea={t} usuarios={usuarios} proyectos={proyectos} areas={areas} />
            </div>
          </details>
          <ReasignarForm tareaId={t.id} usuarios={usuarios} responsableActual={t.responsable} />
          <EliminarForm tareaId={t.id} />
        </div>
      )}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SeccionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 14px", background: "#f8fafc",
      borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ fontWeight: 700, fontSize: "0.85rem", color }}>{label}</span>
      <span style={{
        fontSize: "0.75rem", padding: "1px 7px", borderRadius: 999,
        background: `${color}20`, color, fontWeight: 700,
      }}>{count}</span>
    </div>
  );
}

// ─── Mis tareas view ──────────────────────────────────────────────────────────

function MisTareasView({
  tareas,
  usuarios,
  proyectos,
  areas,
  puedeGestionar,
  userName,
}: {
  tareas: TareaRow[];
  usuarios: { id: string; name: string }[];
  proyectos: string[];
  areas: string[];
  puedeGestionar: boolean;
  userName: string;
}) {
  const porHacer = tareas.filter(t => t.estado === "pendiente");
  const enProgreso = tareas.filter(t => t.estado === "en_progreso");
  const terminadas = tareas.filter(t => ["completada", "cancelada"].includes(t.estado));

  if (tareas.length === 0) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        No tenés tareas asignadas.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {porHacer.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <SeccionHeader label="Por hacer" count={porHacer.length} color="#f59e0b" />
          {porHacer.map(t => (
            <details key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <summary style={{ listStyle: "none", cursor: "pointer" }}>
                <AsanaTareaRow t={t} usuarios={usuarios} proyectos={proyectos} areas={areas} puedeGestionar={puedeGestionar} />
              </summary>
              <div style={{ padding: "0 14px 12px 14px" }}>
                <ComentariosSection tareaId={t.id} comentarios={t.comentarios ?? []} />
              </div>
            </details>
          ))}
        </div>
      )}

      {enProgreso.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <SeccionHeader label="En progreso" count={enProgreso.length} color="#3b82f6" />
          {enProgreso.map(t => (
            <details key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <summary style={{ listStyle: "none", cursor: "pointer" }}>
                <AsanaTareaRow t={t} usuarios={usuarios} proyectos={proyectos} areas={areas} puedeGestionar={puedeGestionar} />
              </summary>
              <div style={{ padding: "0 14px 12px 14px" }}>
                <ComentariosSection tareaId={t.id} comentarios={t.comentarios ?? []} />
              </div>
            </details>
          ))}
        </div>
      )}

      {terminadas.length > 0 && (
        <details>
          <summary style={{
            cursor: "pointer", listStyle: "none", padding: "8px 14px",
            background: "#f8fafc", borderRadius: 10, border: "1px solid var(--border)",
            fontWeight: 700, fontSize: "0.85rem", color: "var(--muted)",
          }}>
            ▶ Completadas / Canceladas ({terminadas.length})
          </summary>
          <div className="card" style={{ padding: 0, overflow: "hidden", marginTop: 6 }}>
            {terminadas.map(t => (
              <details key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <summary style={{ listStyle: "none", cursor: "pointer" }}>
                  <AsanaTareaRow t={t} usuarios={usuarios} proyectos={proyectos} areas={areas} puedeGestionar={puedeGestionar} />
                </summary>
                <div style={{ padding: "0 14px 12px 14px" }}>
                  <ComentariosSection tareaId={t.id} comentarios={t.comentarios ?? []} />
                </div>
              </details>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Todas view ───────────────────────────────────────────────────────────────

function TodasTareasView({
  tareas,
  usuarios,
  proyectos,
  areas,
  stats,
  filtroResp,
  verCompletadas,
  puedeGestionar,
}: {
  tareas: TareaRow[];
  usuarios: { id: string; name: string }[];
  proyectos: string[];
  areas: string[];
  stats: { total: number; pendientes: number; enProgreso: number; atrasadas: number; completadas: number };
  filtroResp: string;
  verCompletadas: boolean;
  puedeGestionar: boolean;
}) {
  return (
    <div>
      {/* Stats strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 10, marginBottom: 18 }}>
        {[
          { label: "Total", value: stats.total, color: "#006878" },
          { label: "Pendientes", value: stats.pendientes, color: "#f59e0b" },
          { label: "En progreso", value: stats.enProgreso, color: "#3b82f6" },
          { label: "Atrasadas", value: stats.atrasadas, color: "#dc2626" },
          { label: "Completadas", value: stats.completadas, color: "#16a34a" },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: "center", padding: "12px 8px" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter toolbar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <form method="GET" style={{ display: "contents" }}>
          <input type="hidden" name="v" value="todas" />
          {verCompletadas && <input type="hidden" name="ver" value="todas" />}
          <select name="filtro" defaultValue={filtroResp} style={{ width: "auto", padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.9rem" }}>
            <option value="">Todos los responsables</option>
            {usuarios.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
          <button type="submit" style={{ width: "auto", padding: "7px 16px", borderRadius: 8 }}>Filtrar</button>
        </form>
        <a
          href={verCompletadas ? "/gestion-tareas?v=todas" : `/gestion-tareas?v=todas&ver=todas${filtroResp ? `&filtro=${encodeURIComponent(filtroResp)}` : ""}`}
          style={{
            padding: "7px 14px", borderRadius: 8,
            background: verCompletadas ? "#16a34a22" : "#f1f5f9",
            color: verCompletadas ? "#15803d" : "var(--muted)",
            fontWeight: 600, fontSize: "0.88rem", textDecoration: "none",
            border: "1px solid var(--border)",
          }}
        >
          {verCompletadas ? "🙈 Ocultar completadas" : "👁 Ver completadas"}
        </a>
      </div>

      {/* Table */}
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
              {puedeGestionar && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {tareas.length === 0 ? (
              <tr>
                <td colSpan={puedeGestionar ? 8 : 7} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
                  No hay tareas con estos filtros
                </td>
              </tr>
            ) : tareas.map(t => {
              const atraso = diasAtraso(t.fechaCierre, t.estado);
              const terminada = ["completada", "cancelada"].includes(t.estado);
              const pColor = prioridadColor(t.prioridad);
              const eColor = estadoColor(t.estado);
              return (
                <tr key={t.id} style={{ opacity: terminada ? 0.65 : 1 }}>
                  <td>
                    <div style={{
                      fontWeight: 600, fontSize: "0.9rem",
                      textDecoration: terminada ? "line-through" : "none",
                      borderLeft: `3px solid ${pColor}`, paddingLeft: 8,
                    }}>
                      {t.descripcion}
                    </div>
                    {t.proyecto && (
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)", paddingLeft: 11 }}>
                        📌 {t.proyecto}{t.area ? ` · ${t.area}` : ""}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: "0.82rem" }}>{t.tipo}</td>
                  <td style={{ fontSize: "0.85rem", fontWeight: 600 }}>{t.responsable ?? "—"}</td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 999,
                      fontSize: "0.75rem", fontWeight: 700,
                      background: `${pColor}22`, color: pColor,
                    }}>
                      {t.prioridad.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{fmtDate(t.fechaCierre) ?? "—"}</td>
                  <td>
                    {atraso > 0
                      ? <span style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.82rem" }}>{atraso}d</span>
                      : <span style={{ color: "#16a34a", fontSize: "0.82rem" }}>Al día</span>
                    }
                  </td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 999,
                      fontSize: "0.75rem", fontWeight: 700,
                      background: `${eColor}22`, color: eColor,
                    }}>
                      {estadoLabel(t.estado)}
                    </span>
                  </td>
                  {puedeGestionar && (
                    <td>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {!terminada && (
                          <form action={async () => { "use server"; await cambiarEstadoTareaAction(t.id, "completada"); }}>
                            <button type="submit" style={{ width: "auto", padding: "4px 10px", fontSize: "0.8rem", borderRadius: 6, background: "#16a34a" }}>✓</button>
                          </form>
                        )}
                        <details style={{ position: "relative" }}>
                          <summary style={{ cursor: "pointer", padding: "4px 10px", borderRadius: 6, background: "#334e5c", color: "#fff", fontWeight: 600, fontSize: "0.8rem", listStyle: "none", display: "inline-block" }}>✏️</summary>
                          <div className="card" style={{ position: "absolute", right: 0, zIndex: 200, minWidth: 380, marginTop: 4 }}>
                            <TareaForm tarea={t} usuarios={usuarios} proyectos={proyectos} areas={areas} />
                          </div>
                        </details>
                        <ReasignarForm tareaId={t.id} usuarios={usuarios} responsableActual={t.responsable} />
                        <EliminarForm tareaId={t.id} />
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tablero (Kanban) view ────────────────────────────────────────────────────

function KanbanCard({
  t,
  usuarios,
  proyectos,
  areas,
  puedeGestionar,
}: {
  t: TareaRow;
  usuarios: { id: string; name: string }[];
  proyectos: string[];
  areas: string[];
  puedeGestionar: boolean;
}) {
  const pColor = prioridadColor(t.prioridad);
  const atraso = diasAtraso(t.fechaCierre, t.estado);
  const fecha = fmtDate(t.fechaCierre);
  const terminada = ["completada", "cancelada"].includes(t.estado);

  return (
    <div style={{
      borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
      padding: 12, background: "#fff",
      borderLeft: `4px solid ${pColor}`,
      marginBottom: 10,
    }}>
      <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: 6, textDecoration: terminada ? "line-through" : "none" }}>
        {t.descripcion}
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {t.proyecto && (
          <span style={{ fontSize: "0.7rem", padding: "1px 6px", borderRadius: 999, background: "#e0f2fe", color: "#0369a1", fontWeight: 600 }}>
            {t.proyecto}
          </span>
        )}
        <span style={{ fontSize: "0.7rem", padding: "1px 6px", borderRadius: 999, background: `${pColor}18`, color: pColor, fontWeight: 700, textTransform: "uppercase" }}>
          {t.prioridad}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem" }}>
        <span style={{ color: "var(--muted)" }}>{t.responsable ?? "—"}</span>
        {fecha && (
          atraso > 0
            ? <span style={{ color: "#dc2626", fontWeight: 700 }}>{fecha} · {atraso}d</span>
            : <span style={{ color: "var(--muted)" }}>{fecha}</span>
        )}
      </div>
      {puedeGestionar && (
        <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
          {t.estado === "pendiente" && (
            <form action={async () => { "use server"; await cambiarEstadoTareaAction(t.id, "en_progreso"); }}>
              <button type="submit" style={{ width: "auto", padding: "3px 8px", fontSize: "0.75rem", borderRadius: 6, background: "#3b82f6" }}>▶ Iniciar</button>
            </form>
          )}
          {t.estado === "en_progreso" && (
            <form action={async () => { "use server"; await cambiarEstadoTareaAction(t.id, "completada"); }}>
              <button type="submit" style={{ width: "auto", padding: "3px 8px", fontSize: "0.75rem", borderRadius: 6, background: "#16a34a" }}>✓ Completar</button>
            </form>
          )}
          <details style={{ position: "relative" }}>
            <summary style={{ cursor: "pointer", padding: "3px 8px", borderRadius: 6, background: "#334e5c", color: "#fff", fontWeight: 600, fontSize: "0.75rem", listStyle: "none", display: "inline-block" }}>✏️</summary>
            <div className="card" style={{ position: "absolute", right: 0, zIndex: 200, minWidth: 380, marginTop: 4 }}>
              <TareaForm tarea={t} usuarios={usuarios} proyectos={proyectos} areas={areas} />
            </div>
          </details>
          <EliminarForm tareaId={t.id} />
        </div>
      )}
    </div>
  );
}

function TableroView({
  tareas,
  usuarios,
  proyectos,
  areas,
  puedeGestionar,
}: {
  tareas: TareaRow[];
  usuarios: { id: string; name: string }[];
  proyectos: string[];
  areas: string[];
  puedeGestionar: boolean;
}) {
  const pendientes = tareas.filter(t => t.estado === "pendiente");
  const enProgreso = tareas.filter(t => t.estado === "en_progreso");
  const completadas = tareas.filter(t => ["completada", "cancelada"].includes(t.estado));

  const columns = [
    { label: "Pendiente", color: "#f59e0b", items: pendientes },
    { label: "En progreso", color: "#3b82f6", items: enProgreso },
    { label: "Completada", color: "#16a34a", items: completadas },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
      {columns.map(col => (
        <div key={col.label}>
          {/* Column header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
            padding: "8px 12px", background: `${col.color}15`,
            borderRadius: 10, borderTop: `3px solid ${col.color}`,
          }}>
            <span style={{ fontWeight: 700, fontSize: "0.9rem", color: col.color }}>{col.label}</span>
            <span style={{
              fontSize: "0.75rem", padding: "1px 8px", borderRadius: 999,
              background: `${col.color}25`, color: col.color, fontWeight: 700,
            }}>
              {col.items.length}
            </span>
          </div>

          {/* Cards */}
          {col.items.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--border)", fontSize: "0.85rem", border: "1.5px dashed var(--border)", borderRadius: 10 }}>
              Sin tareas
            </div>
          ) : col.items.map(t => (
            <KanbanCard key={t.id} t={t} usuarios={usuarios} proyectos={proyectos} areas={areas} puedeGestionar={puedeGestionar} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── TareaForm ────────────────────────────────────────────────────────────────

function TareaForm({ tarea, usuarios, proyectos, areas }: {
  tarea?: {
    id: string; tipo: string; proyecto: string | null; area: string | null;
    descripcion: string; responsable: string | null; comentario: string | null;
    prioridad: string; estado: string; fechaInicio: Date | null; fechaCierre: Date | null;
  };
  usuarios: { id: string; name: string }[];
  proyectos: string[];
  areas: string[];
}) {
  const isEdit = !!tarea;
  const action = isEdit ? editarTareaAction.bind(null, tarea!.id) : crearTareaAction;

  return (
    <form action={action} style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--teal)" }}>{isEdit ? "Editar tarea" : "Nueva tarea"}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Tipo</label>
          <select name="tipo" defaultValue={tarea?.tipo ?? "urgente"} style={{ padding: "7px 10px" }}>
            <option value="urgente">🔴 Urgente</option>
            <option value="seguimiento">🔵 Seguimiento</option>
            <option value="correccion">🟠 Corrección</option>
            <option value="mejora">🟢 Mejora</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Prioridad</label>
          <select name="prioridad" defaultValue={tarea?.prioridad ?? "media"} style={{ padding: "7px 10px" }}>
            <option value="alta">🔺 Alta</option>
            <option value="media">▶ Media</option>
            <option value="baja">🔽 Baja</option>
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
          <select name="proyecto" defaultValue={tarea?.proyecto ?? ""} style={{ padding: "7px 10px" }}>
            <option value="">— Sin proyecto —</option>
            {proyectos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 3 }}>Área</label>
          <select name="area" defaultValue={tarea?.area ?? ""} style={{ padding: "7px 10px" }}>
            <option value="">— Sin área —</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
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

// ─── ReasignarForm ────────────────────────────────────────────────────────────

function ReasignarForm({ tareaId, usuarios, responsableActual }: {
  tareaId: string;
  usuarios: { id: string; name: string }[];
  responsableActual: string | null;
}) {
  return (
    <details style={{ position: "relative" }}>
      <summary style={{ cursor: "pointer", padding: "4px 10px", borderRadius: 6, background: "#e2e8f0", color: "#334e5c", fontWeight: 600, fontSize: "0.8rem", listStyle: "none", display: "inline-block" }}>🔄</summary>
      <div className="card" style={{ position: "absolute", right: 0, zIndex: 200, minWidth: 260, marginTop: 4 }}>
        <p style={{ margin: "0 0 8px", fontSize: "0.85rem", color: "var(--muted)" }}>
          Actualmente: <strong>{responsableActual ?? "—"}</strong>
        </p>
        <form
          action={async (fd: FormData) => {
            "use server";
            await reasignarTareaAction(tareaId, fd.get("responsable") as string);
          }}
          style={{ display: "grid", gap: 8 }}
        >
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

// ─── EliminarForm ─────────────────────────────────────────────────────────────

function EliminarForm({ tareaId }: { tareaId: string }) {
  return (
    <form action={async () => { "use server"; await eliminarTareaAction(tareaId); }}>
      <button type="submit" className="danger" style={{ width: "auto", padding: "4px 10px", fontSize: "0.8rem", borderRadius: 6 }}>
        🗑
      </button>
    </form>
  );
}

// ─── ComentariosSection ───────────────────────────────────────────────────────

function ComentariosSection({ tareaId, comentarios }: {
  tareaId: string;
  comentarios: { id: string; texto: string; autorNombre: string; createdAt: Date }[];
}) {
  const action = agregarComentarioAction.bind(null, tareaId);
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: 8 }}>
        💬 Comentarios ({comentarios.length})
      </div>
      {comentarios.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {comentarios.map(c => (
            <div key={c.id} style={{ background: "#f8fafc", borderRadius: 8, padding: "7px 10px", fontSize: "0.82rem" }}>
              <span style={{ fontWeight: 700, color: "var(--teal)" }}>{c.autorNombre}</span>
              <span style={{ color: "var(--muted)", fontSize: "0.75rem", marginLeft: 8 }}>
                {c.createdAt.toLocaleDateString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <div style={{ marginTop: 3, color: "var(--text)" }}>{c.texto}</div>
            </div>
          ))}
        </div>
      )}
      <form action={action} style={{ display: "flex", gap: 6 }}>
        <input
          name="texto"
          placeholder="Agregar comentario..."
          required
          style={{ flex: 1, padding: "6px 10px", fontSize: "0.82rem", borderRadius: 8 }}
        />
        <button type="submit" style={{ width: "auto", padding: "6px 14px", fontSize: "0.82rem", borderRadius: 8 }}>
          Enviar
        </button>
      </form>
    </div>
  );
}

// ─── Gantt View ───────────────────────────────────────────────────────────────

function GanttView({ tareas }: { tareas: any[] }) {
  if (tareas.length === 0) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        No hay tareas para mostrar en el Gantt.
      </div>
    );
  }

  const today = new Date();

  // Calculate date range: earliest start to latest end (min 3 months)
  const starts = tareas.map(t => new Date(t.createdAt).getTime());
  const ends = tareas.map(t => t.fechaCierre ? new Date(t.fechaCierre).getTime() : today.getTime());
  const rangeStart = new Date(Math.min(...starts));
  const rangeEnd = new Date(Math.max(...ends, today.getTime()));

  // Ensure minimum 3 months range
  const minEnd = new Date(rangeStart);
  minEnd.setMonth(minEnd.getMonth() + 3);
  const effectiveEnd = rangeEnd > minEnd ? rangeEnd : minEnd;

  // Set to start/end of month
  rangeStart.setDate(1);
  effectiveEnd.setDate(28);

  const totalMs = effectiveEnd.getTime() - rangeStart.getTime();

  // Generate month columns
  const months: { label: string; left: number; width: number }[] = [];
  const cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cur <= effectiveEnd) {
    const monthStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const left = Math.max(0, (monthStart.getTime() - rangeStart.getTime()) / totalMs) * 100;
    const width = ((Math.min(monthEnd.getTime(), effectiveEnd.getTime()) - Math.max(monthStart.getTime(), rangeStart.getTime())) / totalMs) * 100;
    months.push({
      label: cur.toLocaleDateString("es-CL", { month: "short", year: "2-digit" }),
      left,
      width,
    });
    cur.setMonth(cur.getMonth() + 1);
  }

  const prioColor: Record<string, string> = {
    alta: "#ef4444", media: "#f97316", baja: "#22c55e",
  };

  const todayLeft = ((today.getTime() - rangeStart.getTime()) / totalMs) * 100;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 700 }}>

          {/* Header row: task name col + month columns */}
          <div style={{ display: "flex", borderBottom: "1.5px solid var(--border)", background: "var(--bg)" }}>
            <div style={{ width: 220, minWidth: 220, padding: "8px 14px", fontWeight: 700, fontSize: "0.8rem", color: "var(--muted)", borderRight: "1.5px solid var(--border)" }}>
              TAREA
            </div>
            <div style={{ flex: 1, position: "relative", height: 36 }}>
              {months.map((m, i) => (
                <div key={i} style={{
                  position: "absolute", left: `${m.left}%`, width: `${m.width}%`,
                  height: "100%", display: "flex", alignItems: "center",
                  borderRight: "1px solid var(--border)", paddingLeft: 8,
                  fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)",
                  overflow: "hidden", whiteSpace: "nowrap",
                }}>
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* Task rows */}
          {tareas.map((t, i) => {
            const taskStart = new Date(t.createdAt);
            const taskEnd = t.fechaCierre ? new Date(t.fechaCierre) : today;
            const left = Math.max(0, (taskStart.getTime() - rangeStart.getTime()) / totalMs) * 100;
            const width = Math.max(0.5, ((taskEnd.getTime() - taskStart.getTime()) / totalMs) * 100);
            const color = prioColor[t.prioridad] ?? "#94a3b8";
            const isCompleted = t.estado === "completada" || t.estado === "cancelada";
            const isLate = !isCompleted && t.fechaCierre && new Date(t.fechaCierre) < today;

            return (
              <div key={t.id} style={{
                display: "flex", alignItems: "center",
                borderBottom: "1px solid var(--border)",
                background: i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.02)",
                minHeight: 44,
              }}>
                {/* Task name */}
                <div style={{
                  width: 220, minWidth: 220, padding: "6px 14px",
                  borderRight: "1.5px solid var(--border)",
                  fontSize: "0.82rem", color: "var(--text)",
                  overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                }}>
                  <span style={{
                    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                    background: color, marginRight: 6, flexShrink: 0,
                  }} />
                  <span style={{ opacity: isCompleted ? 0.5 : 1, textDecoration: isCompleted ? "line-through" : "none" }}>
                    {t.descripcion}
                  </span>
                </div>

                {/* Bar area */}
                <div style={{ flex: 1, position: "relative", height: 44 }}>
                  {/* Month grid lines */}
                  {months.map((m, mi) => (
                    <div key={mi} style={{
                      position: "absolute", left: `${m.left}%`, top: 0, bottom: 0,
                      borderRight: "1px solid var(--border)", opacity: 0.4,
                    }} />
                  ))}

                  {/* Today line */}
                  {todayLeft >= 0 && todayLeft <= 100 && (
                    <div style={{
                      position: "absolute", left: `${todayLeft}%`, top: 0, bottom: 0,
                      borderLeft: "2px dashed var(--accent)", opacity: 0.7, zIndex: 5,
                    }} />
                  )}

                  {/* Task bar */}
                  <div style={{
                    position: "absolute",
                    left: `${Math.min(left, 98)}%`,
                    width: `${Math.min(width, 100 - Math.min(left, 98))}%`,
                    top: "50%", transform: "translateY(-50%)",
                    height: 22, borderRadius: 999,
                    background: color,
                    opacity: isCompleted ? 0.4 : 0.85,
                    border: isLate ? "2px solid #dc2626" : "none",
                    display: "flex", alignItems: "center",
                    paddingLeft: 8, paddingRight: 4,
                    overflow: "hidden",
                    zIndex: 2,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                  }}>
                    <span style={{ fontSize: "0.7rem", color: "#fff", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.responsable ?? "—"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Legend */}
          <div style={{ padding: "10px 14px", display: "flex", gap: 16, alignItems: "center", borderTop: "1.5px solid var(--border)", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>PRIORIDAD:</span>
            {[["alta", "#ef4444", "Alta"], ["media", "#f97316", "Media"], ["baja", "#22c55e", "Baja"]].map(([, c, label]) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "var(--text)" }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: c as string, display: "inline-block" }} />
                {label}
              </span>
            ))}
            <span style={{ marginLeft: 16, display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "var(--text)" }}>
              <span style={{ width: 20, borderTop: "2px dashed var(--accent)", display: "inline-block" }} />
              Hoy
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
