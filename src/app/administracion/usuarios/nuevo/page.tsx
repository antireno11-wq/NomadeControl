import Link from "next/link";
import { ADMIN_ROLES, isFullAdminRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { NewUserForm } from "./new-user-form";

export default async function NuevoUsuarioPage() {
  const user = await requireRole(ADMIN_ROLES);
  const camps = await db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

  return (
    <AppShell
      title="Crear usuario"
      user={user}
      activeNav="administracion"
      showAdminSections
      rightSlot={
        <Link href="/administracion">
          <button type="button" className="secondary">Volver</button>
        </Link>
      }
    >
      <div className="card">
        <NewUserForm
          camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))}
          canAssignFullAdmin={isFullAdminRole(user.role)}
        />
      </div>
    </AppShell>
  );
}
