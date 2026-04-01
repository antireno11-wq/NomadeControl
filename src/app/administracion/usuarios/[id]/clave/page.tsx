import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole, roleLabel } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { resetUserPasswordAction } from "@/app/administracion/actions";

export default async function ResetClaveUsuarioPage({ params }: { params: { id: string } }) {
  const user = await requireRole(ADMIN_ROLES);

  const targetUser = await db.user.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      camp: { select: { name: true } }
    }
  });

  if (!targetUser) {
    notFound();
  }

  return (
    <AppShell
      title="Reset clave"
      user={user}
      activeNav="administracion"
      showAdminSections
      rightSlot={
        <Link href="/administracion">
          <button type="button" className="secondary">Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Usuario</h2>
          <div className="summary-grid">
            <div className="metric">
              <div className="label">Nombre</div>
              <div className="value" style={{ fontSize: "1rem" }}>{targetUser.name}</div>
            </div>
            <div className="metric">
              <div className="label">Correo</div>
              <div className="value" style={{ fontSize: "1rem" }}>{targetUser.email}</div>
            </div>
            <div className="metric">
              <div className="label">Rol</div>
              <div className="value" style={{ fontSize: "1rem" }}>{roleLabel(targetUser.role)}</div>
            </div>
            <div className="metric">
              <div className="label">Campamento</div>
              <div className="value" style={{ fontSize: "1rem" }}>{targetUser.camp?.name ?? "Sin asignar"}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 520 }}>
          <h2 style={{ marginTop: 0 }}>Nueva contraseña</h2>
          <form action={resetUserPasswordAction} className="grid">
            <input type="hidden" name="userId" value={targetUser.id} />
            <div>
              <label htmlFor="new-password">Contraseña nueva</label>
              <input id="new-password" name="newPassword" type="password" minLength={8} required />
            </div>
            <button type="submit">Guardar nueva clave</button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
