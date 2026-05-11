import React from "react";
import Link from "next/link";
import { ADMIN_ROLES, isFullAdminRole, requireRole, roleLabel } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { createCampAction, createProjectAction, deleteCampAction } from "./actions";

export default async function AdministracionPage({
  searchParams
}: {
  searchParams?: { campStatus?: string | string[]; userStatus?: string | string[]; seccion?: string | string[] };
}) {
  const user = await requireRole(ADMIN_ROLES);
  const canDeleteData = isFullAdminRole(user.role);

  const seccionRaw = searchParams?.seccion;
  const seccion = typeof seccionRaw === "string" ? seccionRaw : "usuarios";

  const [users, camps, projects, reports, tareas, incidentes] = await Promise.all([
    db.user.findMany({
      where: { NOT: { email: { endsWith: "@nomade.local" } } },
      include: { camp: true },
      orderBy: [{ role: "asc" }, { name: "asc" }]
    }),
    db.camp.findMany({ orderBy: { name: "asc" } }),
    db.project.findMany({ orderBy: { name: "asc" } }),
    db.dailyReport.count(),
    db.tarea.count({ where: { estado: { in: ["pendiente", "en_progreso"] } } }),
    db.incidente.count({ where: { estado: { in: ["abierto", "en_investigacion"] } } })
  ]);

  const campStatusRaw = searchParams?.campStatus;
  const userStatusRaw = searchParams?.userStatus;
  const campStatus = typeof campStatusRaw === "string" ? campStatusRaw : "";
  const userStatus = typeof userStatusRaw === "string" ? userStatusRaw : "";

  const campAlert =
    campStatus === "updated" ? { type: "success", text: "Cambios guardados correctamente." }
    : campStatus === "deleted" ? { type: "success", text: "Campamento eliminado correctamente." }
    : campStatus === "blocked" ? { type: "error", text: "No se puede eliminar el campamento porque tiene datos o usuarios asociados." }
    : campStatus === "not-found" ? { type: "error", text: "Campamento no encontrado." }
    : campStatus === "invalid" ? { type: "error", text: "Solicitud inválida para eliminar campamento." }
    : null;

  const userAlert =
    userStatus === "deleted" ? { type: "success", text: "Usuario procesado correctamente." } : null;

  const tabs: { key: string; label: string }[] = [
    { key: "usuarios", label: "Usuarios" },
    { key: "campamentos", label: "Campamentos" },
    { key: "proyectos", label: "Proyectos" },
    { key: "sistema", label: "Sistema" },
  ];

  const TAB_STYLES = {
    base: {
      padding: "0.5rem 1.1rem",
      borderRadius: 8,
      fontWeight: 600,
      fontSize: "0.875rem",
      border: "none",
      cursor: "pointer",
      textDecoration: "none",
    } as React.CSSProperties,
    active: { background: "#2563eb", color: "white" } as React.CSSProperties,
    inactive: { background: "transparent", color: "var(--muted)" } as React.CSSProperties,
  };

  return (
    <AppShell title="Administración" user={user} activeNav="administracion" showAdminSections>
      {campAlert ? <div className={`alert ${campAlert.type === "success" ? "success" : "error"}`} style={{ marginBottom: 16 }}>{campAlert.text}</div> : null}
      {userAlert ? <div className="alert success" style={{ marginBottom: 16 }}>{userAlert.text}</div> : null}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div className="card" style={{ textAlign: "center", padding: "1rem" }}>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "#2563eb" }}>{users.length}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Usuarios activos</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "1rem" }}>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "#0891b2" }}>{camps.filter(c => c.isActive).length}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Campamentos activos</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "1rem" }}>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: tareas > 0 ? "#d97706" : "#16a34a" }}>{tareas}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Tareas pendientes</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "1rem" }}>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: incidentes > 0 ? "#dc2626" : "#16a34a" }}>{incidentes}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Incidentes abiertos</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "1rem" }}>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "#7c3aed" }}>{reports}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Informes históricos</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.25rem", borderBottom: "1px solid #e2e8f0", paddingBottom: "0.75rem" }}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/administracion?seccion=${tab.key}`}
            style={{
              ...TAB_STYLES.base,
              ...(seccion === tab.key ? TAB_STYLES.active : TAB_STYLES.inactive),
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* ── USUARIOS ─────────────────────────────────────────────────── */}
      {seccion === "usuarios" && (
        <div className="page-stack">
          <div className="card" style={{ overflowX: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>Usuarios del sistema</h2>
                <p style={{ color: "var(--muted)", fontSize: "0.875rem", margin: "4px 0 0" }}>
                  Gestiona accesos, roles y módulos habilitados por usuario.
                </p>
              </div>
              <Link href="/administracion/usuarios/nuevo">
                <button type="button">Crear usuario</button>
              </Link>
            </div>
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Campamento</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 500 }}>{row.name}</td>
                    <td style={{ color: "var(--muted)", fontSize: "0.875rem" }}>{row.email}</td>
                    <td>
                      <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: 4, background: "#f1f5f9", fontWeight: 700 }}>
                        {roleLabel(row.role)}
                      </span>
                    </td>
                    <td>{row.camp?.name ?? <span style={{ color: "var(--muted)" }}>Sin asignar</span>}</td>
                    <td>
                      <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: row.isActive ? "#dcfce7" : "#fee2e2", color: row.isActive ? "#166534" : "#991b1b" }}>
                        {row.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td>
                      <Link href={`/administracion/usuarios/${row.id}`}>
                        <button type="button" className="secondary">Editar</button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CAMPAMENTOS ──────────────────────────────────────────────── */}
      {seccion === "campamentos" && (
        <div className="page-stack">
          <div className="card" style={{ maxWidth: 820 }}>
            <h2 style={{ marginTop: 0 }}>Crear campamento</h2>
            <form action={createCampAction} className="grid two">
              <div>
                <label htmlFor="camp-name">Nombre</label>
                <input id="camp-name" name="name" required />
              </div>
              <div>
                <label htmlFor="camp-location">Ubicación</label>
                <input id="camp-location" name="location" />
              </div>
              <div>
                <label htmlFor="camp-capacity">Capacidad de personas</label>
                <input id="camp-capacity" name="capacityPeople" type="number" min={0} defaultValue={0} required />
              </div>
              <div>
                <label htmlFor="camp-potable-capacity">Estanque agua potable (m³)</label>
                <input id="camp-potable-capacity" name="potableWaterTankCapacityM3" type="number" min={0} step="0.1" />
              </div>
              <div>
                <label htmlFor="camp-black-capacity">Estanque aguas negras (m³)</label>
                <input id="camp-black-capacity" name="blackWaterTankCapacityM3" type="number" min={0} step="0.1" />
              </div>
              <div>
                <label htmlFor="camp-grey-capacity">Estanque aguas grises (m³)</label>
                <input id="camp-grey-capacity" name="greyWaterTankCapacityM3" type="number" min={0} step="0.1" />
              </div>
              <div>
                <label htmlFor="camp-latitude">Latitud</label>
                <input id="camp-latitude" name="latitude" type="number" step="0.000001" placeholder="-22.334455" />
              </div>
              <div>
                <label htmlFor="camp-longitude">Longitud</label>
                <input id="camp-longitude" name="longitude" type="number" step="0.000001" placeholder="-68.778899" />
              </div>
              <div style={{ display: "flex", alignItems: "end" }}>
                <button type="submit">Crear campamento</button>
              </div>
            </form>
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Campamentos registrados</h2>
            <table className="admin-camps-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Ubicación</th>
                  <th>Coordenadas</th>
                  <th>Capacidad</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {camps.map((camp) => (
                  <tr key={camp.id}>
                    <td style={{ fontWeight: 500 }}>{camp.name}</td>
                    <td>{camp.location ?? <span style={{ color: "var(--muted)" }}>-</span>}</td>
                    <td style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                      {camp.latitude != null && camp.longitude != null
                        ? `${camp.latitude.toFixed(5)}, ${camp.longitude.toFixed(5)}`
                        : "-"}
                    </td>
                    <td>{camp.capacityPeople} pers.</td>
                    <td>
                      <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: camp.isActive ? "#dcfce7" : "#f1f5f9", color: camp.isActive ? "#166534" : "#6b7280" }}>
                        {camp.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/administracion/campamentos/${camp.id}`}>
                          <button type="button" className="secondary">Editar</button>
                        </Link>
                        {canDeleteData ? (
                          <form action={deleteCampAction}>
                            <input type="hidden" name="campId" value={camp.id} />
                            <button type="submit" className="danger">Eliminar</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PROYECTOS ────────────────────────────────────────────────── */}
      {seccion === "proyectos" && (
        <div className="page-stack">
          <div className="card" style={{ maxWidth: 640 }}>
            <h2 style={{ marginTop: 0 }}>Crear proyecto</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.875rem", margin: "0 0 1rem" }}>
              Los proyectos se usan para clasificar tareas y vehículos.
            </p>
            <form action={createProjectAction} className="grid two">
              <div>
                <label htmlFor="project-name">Nombre</label>
                <input id="project-name" name="name" required />
              </div>
              <div>
                <label htmlFor="project-code">Código</label>
                <input id="project-code" name="code" placeholder="FS-2026" />
              </div>
              <div>
                <label htmlFor="project-location">Ubicación</label>
                <input id="project-location" name="location" placeholder="Faena, ciudad o zona" />
              </div>
              <div style={{ display: "flex", alignItems: "end" }}>
                <button type="submit">Crear proyecto</button>
              </div>
            </form>
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Proyectos registrados</h2>
            <table className="admin-camps-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Código</th>
                  <th>Ubicación</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td style={{ fontWeight: 500 }}>{project.name}</td>
                    <td style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: "0.875rem" }}>{project.code ?? "-"}</td>
                    <td>{project.location ?? "-"}</td>
                    <td>
                      <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: project.isActive ? "#dcfce7" : "#f1f5f9", color: project.isActive ? "#166534" : "#6b7280" }}>
                        {project.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                  </tr>
                ))}
                {projects.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--muted)", padding: "1rem" }}>Todavía no hay proyectos creados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ maxWidth: 640 }}>
            <h2 style={{ marginTop: 0 }}>Configuración de tareas</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0 0 12px" }}>
              Administra los proyectos y áreas disponibles al crear tareas.
            </p>
            <Link href="/administracion/configuracion">
              <button type="button" className="secondary">Gestionar proyectos y áreas</button>
            </Link>
          </div>
        </div>
      )}

      {/* ── SISTEMA ──────────────────────────────────────────────────── */}
      {seccion === "sistema" && (
        <div className="page-stack">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem" }}>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Auditoría y registros</h3>
              <p style={{ color: "var(--muted)", fontSize: "0.875rem", margin: "0 0 1rem" }}>
                Revisa y gestiona los registros históricos del sistema: informes diarios, controles de tareas, movimientos de bodega y fichas de trabajadores.
              </p>
              {canDeleteData ? (
                <Link href="/administracion/registros">
                  <button type="button" className="danger">Abrir administración de registros</button>
                </Link>
              ) : (
                <p style={{ color: "var(--muted)", fontSize: "0.8rem", fontStyle: "italic" }}>Solo el administrador principal puede borrar registros.</p>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Información del sistema</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ color: "var(--muted)" }}>Total usuarios</span>
                  <strong>{users.length}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ color: "var(--muted)" }}>Campamentos activos</span>
                  <strong>{camps.filter(c => c.isActive).length}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ color: "var(--muted)" }}>Proyectos activos</span>
                  <strong>{projects.filter(p => p.isActive).length}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0" }}>
                  <span style={{ color: "var(--muted)" }}>Informes históricos</span>
                  <strong>{reports}</strong>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </AppShell>
  );
}
