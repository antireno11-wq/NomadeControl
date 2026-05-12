import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ADMIN_ROLES,
  ALL_MODULES,
  isAdminRole,
  isFullAdminRole,
  parseModulePermissions,
  requireRole,
  roleLabel,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { deleteUserAction, updateUserAccessAction, updateUserModulesAction } from "@/app/administracion/actions";
import { ModulesChooser } from "@/components/modules-chooser";

// Descripción legible de lo que puede hacer cada rol
const ROLE_SUMMARY: Record<string, { puede: string[]; noPuede: string[] }> = {
  ADMINISTRADOR: {
    puede: ["Acceso total a todos los módulos y configuración del sistema"],
    noPuede: [],
  },
  ADMIN: {
    puede: ["Acceso total a todos los módulos y configuración del sistema"],
    noPuede: [],
  },
  ADMIN_LIMITADO: {
    puede: ["Acceso a todos los módulos operativos", "Crear y editar usuarios", "Ver auditoría"],
    noPuede: ["Eliminar datos permanentemente", "Borrar usuarios"],
  },
  SUPERVISOR: {
    puede: ["Dashboard", "Operaciones de campamento", "HSEC / Prevención", "Trabajadores", "Tareas", "Bodega"],
    noPuede: ["Administración", "Configuración del sistema"],
  },
  OPERADOR: {
    puede: ["Dashboard", "Operaciones", "Tareas", "Bodega", "HSEC"],
    noPuede: ["Administración", "Trabajadores (gestión)", "Configuración"],
  },
  OFICINA: {
    puede: ["Tareas", "Biblioteca"],
    noPuede: ["Dashboard operacional", "Campamentos", "HSEC", "Trabajadores", "Vehículos"],
  },
  COLABORADOR: {
    puede: ["Ver sus tareas asignadas", "Biblioteca de documentos"],
    noPuede: ["Crear o editar tareas", "Módulos operacionales", "Administración"],
  },
  VEHICULOS: {
    puede: ["Módulo de Vehículos únicamente"],
    noPuede: ["Todos los demás módulos"],
  },
};

export default async function EditarUsuarioPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string | string[] };
}) {
  const user = await requireRole(ADMIN_ROLES);

  const [targetUser, camps] = await Promise.all([
    db.user.findUnique({ where: { id: params.id }, include: { camp: true } }),
    db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  if (!targetUser) notFound();

  const canDeleteUsers = isFullAdminRole(user.role);
  const targetIsAdmin = isAdminRole(targetUser.role);
  const currentModules = parseModulePermissions(targetUser.modulePermissions);
  const roleSummary = ROLE_SUMMARY[targetUser.role];

  const statusRaw = searchParams?.status;
  const status = typeof statusRaw === "string" ? statusRaw : "";
  const alert =
    status === "saved"   ? { type: "success", text: "Cambios guardados correctamente." }
    : status === "deleted" ? { type: "success", text: "Usuario procesado correctamente." }
    : null;

  return (
    <AppShell
      title="Editar usuario"
      user={user}
      activeNav="administracion"
      showAdminSections
      rightSlot={
        <Link href="/administracion">
          <button type="button" className="secondary">← Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        {alert ? <div className={`alert ${alert.type}`}>{alert.text}</div> : null}

        {/* ── Resumen ──────────────────────────────────────────────────────── */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "var(--teal)", color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", fontWeight: 800, flexShrink: 0,
              }}>
                {targetUser.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{targetUser.name}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 2 }}>{targetUser.email}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.75rem", padding: "2px 10px", borderRadius: 20, fontWeight: 700, background: "#f1f5f9", color: "#374151" }}>
                    {roleLabel(targetUser.role)}
                  </span>
                  <span style={{ fontSize: "0.75rem", padding: "2px 10px", borderRadius: 20, fontWeight: 700, background: targetUser.isActive ? "#dcfce7" : "#fee2e2", color: targetUser.isActive ? "#166534" : "#991b1b" }}>
                    {targetUser.isActive ? "Activo" : "Inactivo"}
                  </span>
                  {targetUser.camp && (
                    <span style={{ fontSize: "0.75rem", padding: "2px 10px", borderRadius: 20, fontWeight: 600, background: "#eff6ff", color: "#1d4ed8" }}>
                      🏕 {targetUser.camp.name}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Botón reset clave */}
            <Link href={`/administracion/usuarios/${targetUser.id}/clave`}>
              <button type="button" className="secondary">🔑 Cambiar contraseña</button>
            </Link>
          </div>
        </div>

        {/* ── Acceso y asignación ──────────────────────────────────────────── */}
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
                <option value="SUPERVISOR">Supervisor</option>
                {canDeleteUsers ? <option value="ADMINISTRADOR">Administrador</option> : null}
                <option value="ADMIN_LIMITADO">Admin limitado</option>
                <option value="VEHICULOS">Solo vehículos</option>
                <option value="OFICINA">Oficina</option>
                <option value="COLABORADOR">Colaborador</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-user-camp">Campamento</label>
              <select id="edit-user-camp" name="campId" defaultValue={targetUser.campId ?? "none"}>
                <option value="none">Sin asignar</option>
                {camps.map((camp) => (
                  <option key={camp.id} value={camp.id}>{camp.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" name="isActive" defaultChecked={targetUser.isActive} />
                <span>Usuario activo</span>
              </label>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit">Guardar cambios</button>
            </div>
          </form>
        </div>

        {/* ── Permisos de módulos ──────────────────────────────────────────── */}
        <div className="card" style={{ maxWidth: 760 }}>
          <h2 style={{ marginTop: 0 }}>Acceso a módulos</h2>

          {/* Resumen del rol */}
          {roleSummary && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20, padding: "14px 16px", background: "rgba(0,0,0,0.02)", borderRadius: 10, border: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                  ✅ Lo que puede hacer este rol
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.85rem", lineHeight: 1.7, color: "#166534" }}>
                  {roleSummary.puede.map(p => <li key={p}>{p}</li>)}
                </ul>
              </div>
              {roleSummary.noPuede.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    ❌ Lo que no puede hacer
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.85rem", lineHeight: 1.7, color: "#991b1b" }}>
                    {roleSummary.noPuede.map(p => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {targetIsAdmin ? (
            <div style={{ padding: "14px 16px", borderRadius: 8, background: "#eff6ff", border: "1px solid #bfdbfe", fontSize: "0.875rem", color: "#1d4ed8" }}>
              Los administradores tienen acceso total a todos los módulos. No se pueden restringir permisos para este rol.
            </div>
          ) : (
            <>
              <p style={{ color: "var(--muted)", fontSize: "0.875rem", margin: "0 0 1rem" }}>
                Marca los módulos que este usuario puede ver. Los permisos son independientes del rol asignado.
              </p>
              <form action={updateUserModulesAction}>
                <input type="hidden" name="userId" value={targetUser.id} />
                <div style={{ marginBottom: "1rem" }}>
                  <ModulesChooser
                    modules={ALL_MODULES as unknown as { key: string; label: string; description: string }[]}
                    initialChecked={currentModules}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="submit">Guardar permisos</button>
                </div>
              </form>
            </>
          )}
        </div>

        {/* ── Zona sensible ────────────────────────────────────────────────── */}
        {targetUser.id !== user.id && canDeleteUsers ? (
          <div className="card" style={{ maxWidth: 760, border: "1px solid #fecaca" }}>
            <h2 style={{ marginTop: 0, color: "#991b1b" }}>Zona sensible</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.875rem", margin: "0 0 12px" }}>
              Si el usuario tiene historial, se desactiva y anonimiza. Si no tiene registros, se elimina por completo.
            </p>
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
