import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { createCampAction, createProjectAction, deleteCampAction } from "./actions";

export default async function AdministracionPage({
  searchParams
}: {
  searchParams?: { campStatus?: string | string[]; userStatus?: string | string[] };
}) {
  const user = await requireRole(ADMIN_ROLES);

  const [users, camps, projects, reports] = await Promise.all([
    db.user.findMany({
      where: {
        NOT: {
          email: {
            endsWith: "@nomade.local"
          }
        }
      },
      include: { camp: true },
      orderBy: [{ role: "asc" }, { name: "asc" }]
    }),
    db.camp.findMany({ orderBy: { name: "asc" } }),
    db.project.findMany({ orderBy: { name: "asc" } }),
    db.dailyReport.count()
  ]);

  const campStatusRaw = searchParams?.campStatus;
  const userStatusRaw = searchParams?.userStatus;
  const campStatus = typeof campStatusRaw === "string" ? campStatusRaw : "";
  const userStatus = typeof userStatusRaw === "string" ? userStatusRaw : "";
  const campAlert =
    campStatus === "updated"
      ? { type: "success", text: "Cambios guardados correctamente." }
      : campStatus === "deleted"
      ? { type: "success", text: "Campamento eliminado correctamente." }
      : campStatus === "blocked"
        ? { type: "error", text: "No se puede eliminar el campamento porque tiene datos o usuarios asociados." }
        : campStatus === "not-found"
          ? { type: "error", text: "Campamento no encontrado." }
          : campStatus === "invalid"
            ? { type: "error", text: "Solicitud inválida para eliminar campamento." }
            : null;
  const userAlert =
    userStatus === "deleted" ? { type: "success", text: "Usuario procesado correctamente." } : null;

  return (
    <AppShell title="Administración" user={user} activeNav="administracion" showAdminSections>
      {campAlert ? <div className={`alert ${campAlert.type === "success" ? "success" : "error"}`} style={{ marginBottom: 16 }}>{campAlert.text}</div> : null}
      {userAlert ? <div className="alert success" style={{ marginBottom: 16 }}>{userAlert.text}</div> : null}

      <div className="admin-metrics-grid" style={{ marginBottom: 16 }}>
        <div className="metric">
          <div className="label">Usuarios</div>
          <div className="value">{users.length}</div>
        </div>
        <div className="metric">
          <div className="label">Campamentos</div>
          <div className="value">{camps.length}</div>
        </div>
        <div className="metric">
          <div className="label">Reportes históricos</div>
          <div className="value">{reports}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Gestión de registros</h2>
            <div style={{ color: "var(--muted)", marginTop: 6 }}>
              Usa una ventana aparte para revisar y borrar registros del sistema.
            </div>
          </div>
          <Link href="/administracion/registros">
            <button type="button" className="danger">Abrir administración de registros</button>
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
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

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Crear proyecto</h2>
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

      <div className="card admin-users-card" style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Usuarios del sistema</h2>
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
              <th>Campamento asignado</th>
              <th>Activo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.email}</td>
                <td>{row.role === "ADMIN" ? "ADMINISTRADOR" : row.role}</td>
                <td>{row.camp?.name ?? "Sin asignar"}</td>
                <td>{row.isActive ? "Sí" : "No"}</td>
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

      <div className="card admin-camps-card" style={{ marginTop: 16, overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Campamentos</h2>
        <table className="admin-camps-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Ubicación</th>
              <th>Coordenadas</th>
              <th>Capacidad</th>
              <th>Activo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {camps.map((camp) => (
              <tr key={camp.id}>
                <td>{camp.name}</td>
                <td>{camp.location ?? "-"}</td>
                <td>{camp.latitude != null && camp.longitude != null ? `${camp.latitude.toFixed(5)}, ${camp.longitude.toFixed(5)}` : "-"}</td>
                <td>{camp.capacityPeople}</td>
                <td>{camp.isActive ? "Sí" : "No"}</td>
                <td>
                  <div className="admin-user-secondary-actions" style={{ marginTop: 0 }}>
                    <Link href={`/administracion/campamentos/${camp.id}`}>
                      <button type="button" className="secondary">Editar</button>
                    </Link>
                    <form action={deleteCampAction}>
                      <input type="hidden" name="campId" value={camp.id} />
                      <button type="submit" className="danger">Eliminar campamento</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card admin-camps-card" style={{ marginTop: 16, overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Proyectos</h2>
        <table className="admin-camps-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>Ubicación</th>
              <th>Activo</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <td>{project.name}</td>
                <td>{project.code ?? "-"}</td>
                <td>{project.location ?? "-"}</td>
                <td>{project.isActive ? "Sí" : "No"}</td>
              </tr>
            ))}
            {projects.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>Todavía no hay proyectos creados.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
