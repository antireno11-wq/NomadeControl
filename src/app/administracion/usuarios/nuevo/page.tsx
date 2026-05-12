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
          <button type="button" className="secondary">← Volver</button>
        </Link>
      }
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        {/* Hero */}
        <div className="hero-panel" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14, flexShrink: 0,
              background: "linear-gradient(135deg, var(--teal), #00a6b6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.5rem",
            }}>
              👤
            </div>
            <div>
              <div className="hero-kicker">Administración</div>
              <h1 style={{ margin: 0, fontSize: "1.4rem", lineHeight: 1.2 }}>Nuevo usuario</h1>
              <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--muted)" }}>
                Completá los 4 pasos para dar acceso a un nuevo miembro del equipo.
              </p>
            </div>
          </div>
        </div>

        <NewUserForm
          camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))}
          canAssignFullAdmin={isFullAdminRole(user.role)}
        />
      </div>
    </AppShell>
  );
}
