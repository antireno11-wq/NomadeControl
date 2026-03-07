import Image from "next/image";
import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";

export default async function AdministracionPage() {
  const user = await requireRole(ADMIN_ROLES);

  const [users, camps, reports] = await Promise.all([
    db.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
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

      <OpsNav active="administracion" />

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
        <h2 style={{ marginTop: 0 }}>Usuarios del sistema</h2>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
            </tr>
          </thead>
          <tbody>
            {users.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.email}</td>
                <td>{row.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
