import Image from "next/image";
import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logoutAction } from "@/app/dashboard/actions";
import { createUserAction } from "@/app/administracion/actions";

export default async function NuevoUsuarioPage({ searchParams }: { searchParams?: { ok?: string } }) {
  const user = await requireRole(ADMIN_ROLES);
  const camps = await db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Crear usuario</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesión: {user.name} ({user.role})
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/administracion">
            <button type="button" className="secondary">Volver a administración</button>
          </Link>
          <form action={logoutAction}>
            <button className="danger" type="submit">Cerrar sesión</button>
          </form>
        </div>
      </div>

      <div className="card">
        {searchParams?.ok === "1" ? (
          <div className="alert success" style={{ marginBottom: 12 }}>
            Usuario creado correctamente.
          </div>
        ) : null}

        <form action={createUserAction} className="grid two">
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
      </div>
    </main>
  );
}
