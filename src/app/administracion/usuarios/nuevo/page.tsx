import Image from "next/image";
import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logoutAction } from "@/app/dashboard/actions";
import { NewUserForm } from "./new-user-form";

export default async function NuevoUsuarioPage() {
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
          <Link href="/mi-perfil" className="menu-item">
            Mi perfil
          </Link>
          <Link href="/administracion">
            <button type="button" className="secondary">Volver a administración</button>
          </Link>
          <form action={logoutAction}>
            <button className="danger" type="submit">Cerrar sesión</button>
          </form>
        </div>
      </div>

      <div className="card">
        <NewUserForm camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))} />
      </div>
    </main>
  );
}
