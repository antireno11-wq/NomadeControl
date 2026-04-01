import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, isFullAdminRole, requireRole, roleLabel } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { deleteUserAction, resetUserPasswordAction, updateUserAccessAction } from "@/app/administracion/actions";

export default async function EditarUsuarioPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { status?: string | string[] };
}) {
  const user = await requireRole(ADMIN_ROLES);

  const [targetUser, camps] = await Promise.all([
    db.user.findUnique({
      where: { id: params.id },
      include: { camp: true }
    }),
    db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })
  ]);

  if (!targetUser) notFound();
  const canDeleteUsers = isFullAdminRole(user.role);

  const statusRaw = searchParams?.status;
  const status = typeof statusRaw === "string" ? statusRaw : "";
  const alert =
    status === "saved"
      ? { type: "success", text: "Cambios guardados correctamente." }
      : status === "password"
        ? { type: "success", text: "Clave actualizada correctamente." }
        : status === "deleted"
          ? { type: "success", text: "Usuario procesado correctamente." }
          : null;

  return (
    <AppShell
      title="Editar usuario"
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
        {alert ? <div className={`alert ${alert.type}`}>{alert.text}</div> : null}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Resumen</h2>
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

        <div className="card" style={{ maxWidth: 760 }}>
          <h2 style={{ marginTop: 0 }}>Acceso y asignación</h2>
          <form action={updateUserAccessAction} className="grid two">
            <input type="hidden" name="userId" value={targetUser.id} />
            <input type="hidden" name="redirectTo" value={`/administracion/usuarios/${targetUser.id}?status=saved`} />
            <div>
              <label htmlFor="edit-user-name">Nombre</label>
              <input id="edit-user-name" name="name" defaultValue={targetUser.name} required />
            </div>
            <div>
              <label htmlFor="edit-user-role">Rol</label>
              <select id="edit-user-role" name="role" defaultValue={targetUser.role === "ADMIN" ? "ADMINISTRADOR" : targetUser.role}>
                <option value="SUPERVISOR">SUPERVISOR</option>
                {canDeleteUsers ? <option value="ADMINISTRADOR">ADMINISTRADOR</option> : null}
                <option value="ADMIN_LIMITADO">ADMIN LIMITADO</option>
                <option value="VEHICULOS">SOLO VEHÍCULOS</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-user-camp">Campamento</label>
              <select id="edit-user-camp" name="campId" defaultValue={targetUser.campId ?? "none"}>
                <option value="none">Sin asignar</option>
                {camps.map((camp) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="vehicle-inline-option">
              <label>
                <input type="checkbox" name="isActive" defaultChecked={targetUser.isActive} />
                Usuario activo
              </label>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit">Guardar cambios</button>
            </div>
          </form>
        </div>

        <div className="card" style={{ maxWidth: 760 }}>
          <h2 style={{ marginTop: 0 }}>Reset de clave</h2>
          <form action={resetUserPasswordAction} className="grid two">
            <input type="hidden" name="userId" value={targetUser.id} />
            <input type="hidden" name="redirectTo" value={`/administracion/usuarios/${targetUser.id}?status=password`} />
            <div>
              <label htmlFor="edit-user-password">Nueva contraseña</label>
              <input id="edit-user-password" name="newPassword" type="password" minLength={8} required />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="submit" className="secondary">Guardar nueva clave</button>
            </div>
          </form>
        </div>

        {targetUser.id !== user.id && canDeleteUsers ? (
          <div className="card" style={{ maxWidth: 760 }}>
            <h2 style={{ marginTop: 0 }}>Zona sensible</h2>
            <div className="section-caption" style={{ marginBottom: 12 }}>
              Si el usuario tiene historial, se desactiva y anonimiza. Si no tiene registros, se elimina por completo.
            </div>
            <form action={deleteUserAction}>
              <input type="hidden" name="userId" value={targetUser.id} />
              <input type="hidden" name="redirectTo" value="/administracion?userStatus=deleted" />
              <button type="submit" className="danger">Borrar usuario</button>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
