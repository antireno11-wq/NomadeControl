import Image from "next/image";
import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";
import { createUserAction, resetUserPasswordAction, updateUserAccessAction } from "./actions";

export default async function AdministracionPage() {
  const user = await requireRole(ADMIN_ROLES);

  const [users, camps, reports] = await Promise.all([
    db.user.findMany({ include: { camp: true }, orderBy: [{ role: "asc" }, { name: "asc" }] }),
    db.camp.findMany({ orderBy: { name: "asc" } }),
    db.dailyReport.count()
  ]);

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Administración</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesión: {user.name} ({user.role})
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="administracion" showLoadSection={false} />

      <div className="grid two" style={{ marginBottom: 16 }}>
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

      <div className="card" style={{ overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Crear usuario</h2>
        <form action={createUserAction} className="grid two" style={{ marginBottom: 18 }}>
          <div>
            <label htmlFor="new-name">Nombre</label>
            <input id="new-name" name="name" required />
          </div>
          <div>
            <label htmlFor="new-email">Correo</label>
            <input id="new-email" name="email" type="email" required />
          </div>
          <div>
            <label htmlFor="new-role">Rol</label>
            <select id="new-role" name="role" defaultValue="SUPERVISOR">
              <option value="SUPERVISOR">SUPERVISOR</option>
              <option value="ADMINISTRADOR">ADMINISTRADOR</option>
            </select>
          </div>
          <div>
            <label htmlFor="new-camp">Campamento (solo supervisor)</label>
            <select id="new-camp" name="campId" defaultValue="none">
              <option value="none">Sin asignar</option>
              {camps.map((camp) => (
                <option key={camp.id} value={camp.id}>
                  {camp.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-password">Contraseña inicial</label>
            <input id="new-password" name="password" type="password" minLength={8} required />
          </div>
          <div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 28 }}>
              <input type="checkbox" name="sendWelcomeEmail" defaultChecked style={{ width: "auto", padding: 0 }} />
              Enviar credenciales por correo
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="submit">Crear usuario</button>
          </div>
        </form>

        <h2 style={{ marginTop: 0 }}>Usuarios del sistema</h2>
        <table>
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
                  <form action={updateUserAccessAction} className="grid" style={{ gap: 8 }}>
                    <input type="hidden" name="userId" value={row.id} />
                    <input name="name" defaultValue={row.name} placeholder="Nombre" />
                    <select name="role" defaultValue={row.role === "ADMIN" ? "ADMINISTRADOR" : row.role}>
                      <option value="SUPERVISOR">SUPERVISOR</option>
                      <option value="ADMINISTRADOR">ADMINISTRADOR</option>
                    </select>
                    <select name="campId" defaultValue={row.campId ?? "none"}>
                      <option value="none">Sin asignar</option>
                      {camps.map((camp) => (
                        <option key={camp.id} value={camp.id}>
                          {camp.name}
                        </option>
                      ))}
                    </select>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                      <input type="checkbox" name="isActive" defaultChecked={row.isActive} style={{ width: "auto", padding: 0 }} />
                      Activo
                    </label>
                    <button type="submit" className="secondary">Guardar acceso</button>
                  </form>
                  <form action={resetUserPasswordAction} className="grid" style={{ gap: 8, marginTop: 8 }}>
                    <input type="hidden" name="userId" value={row.id} />
                    <input name="newPassword" type="password" minLength={8} placeholder="Nueva clave" />
                    <button type="submit" className="secondary">Reset clave</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
