import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { logoutAction } from "@/app/dashboard/actions";
import { NotificationBell } from "@/components/notification-bell";
import { canAccessAdministration, canAccessBiblioteca, canAccessCampOperations, canAccessDashboard, canAccessEvaluaciones, canAccessVehicles, canManageTareas, canViewTareas, isVehicleOnlyRole } from "@/lib/auth";

type ShellNavKey = "dashboard" | "resumen" | "trabajadores" | "vehiculos" | "carga" | "tareas" | "biblioteca" | "gestion-tareas" | "evaluaciones" | "administracion" | null;

type NotificationItem = {
  text: string;
  severity: "warning" | "error" | "info";
};

export function AppShell({
  title,
  user,
  activeNav,
  showAdminSections = false,
  rightSlot,
  notifications,
  children
}: {
  title: string;
  user: { name: string; role: string };
  activeNav: ShellNavKey;
  showAdminSections?: boolean;
  rightSlot?: ReactNode;
  notifications?: NotificationItem[];
  children: ReactNode;
}) {
  const canSeeDashboard = canAccessDashboard(user.role);
  const canSeeVehicles = canAccessVehicles(user.role);
  const canSeeCampOps = canAccessCampOperations(user.role) && !canAccessAdministration(user.role);
  const canSeeWorkers = canAccessCampOperations(user.role);
  const canSeeAdministration = canAccessAdministration(user.role);
  const canSeeBiblioteca = canAccessBiblioteca(user.role);
  const canSeeGestionTareas = canManageTareas(user.role);
  const canSeeTareasBasic = canViewTareas(user.role);
  const canSeeEvaluaciones = canAccessEvaluaciones(user.role);
  const isOfficeRole = user.role === "OFICINA" || user.role === "COLABORADOR";
  const navItems = [
    ...(!isVehicleOnlyRole(user.role) ? [{ href: "/", label: "🏠 Inicio", key: null as any }] : []),
    ...(!isOfficeRole && canSeeDashboard ? [{ href: "/dashboard", label: "Dashboard", key: "dashboard" as const }] : []),
    ...(!isOfficeRole && canSeeDashboard ? [{ href: "/resumen-general", label: "Resumen general", key: "resumen" as const }] : []),
    ...(!isOfficeRole && canSeeWorkers ? [{ href: "/trabajadores", label: "Trabajadores", key: "trabajadores" as const }] : []),
    ...(!isOfficeRole && canSeeVehicles ? [{ href: "/vehiculos", label: "Vehículos", key: "vehiculos" as const }] : []),
    ...(canSeeCampOps && !isOfficeRole
      ? [
          { href: "/carga-diaria", label: "Informe diario", key: "carga" as const },
          { href: "/control-tareas-diarias", label: "Control tareas", key: "tareas" as const }
        ]
      : []),
    ...(canSeeTareasBasic ? [{ href: "/gestion-tareas", label: "Gestión de tareas", key: "gestion-tareas" as const }] : []),
    ...(canSeeBiblioteca ? [{ href: "/biblioteca", label: "Biblioteca", key: "biblioteca" as const }] : []),
    ...(canSeeEvaluaciones ? [{ href: "/evaluaciones", label: "📊 Evaluaciones", key: "evaluaciones" as const }] : []),
    ...(canSeeAdministration ? [{ href: "/administracion", label: "Administración", key: "administracion" as const }] : [])
  ];

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar-card">
          <Link href="/" aria-label="Ir al inicio" className="dashboard-brand">
            <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={112} height={112} priority />
            <div>
              <strong>Nomade Control</strong>
              <span>{title}</span>
            </div>
          </Link>

          <nav className="dashboard-nav">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={`dashboard-nav-link ${activeNav === item.key ? "active" : ""}`}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="dashboard-sidebar-footer">
            <Link href="/mi-perfil" className="dashboard-mini-link">
              Mi perfil
            </Link>
            <form action={logoutAction}>
              <button className="danger" type="submit">
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      </aside>

      <section className="dashboard-main">
        <div className="dashboard-topbar">
          <div>
            <h1>{title}</h1>
          </div>
          <div className="dashboard-topbar-actions">
            {rightSlot}
            {notifications && notifications.length > 0 ? <NotificationBell items={notifications} /> : null}
            <div className="dashboard-user">{user.name}</div>
          </div>
        </div>

        {children}
      </section>
    </main>
  );
}
