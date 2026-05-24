import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { logoutAction } from "@/app/dashboard/actions";
import { NotificationBell } from "@/components/notification-bell";
import {
  canAccessAdministration, canAccessBiblioteca,
  canAccessDashboard, canAccessHSEC, canAccessVehicles, canViewTareas,
  canAccessTrabajadores, isVehicleOnlyRole, canAccessModule, parseModulePermissions
} from "@/lib/auth";
import { NavMenu, type NavEntry } from "@/components/nav-menu";

type ShellNavKey = "dashboard" | "resumen" | "trabajadores" | "vehiculos" | "carga" | "tareas" | "biblioteca" | "gestion-tareas" | "evaluaciones" | "hsec" | "administracion" | "operaciones" | null;

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
  user: { name: string; role: string; modulePermissions?: unknown };
  activeNav: ShellNavKey;
  showAdminSections?: boolean;
  rightSlot?: ReactNode;
  notifications?: NotificationItem[];
  children: ReactNode;
}) {
  const mods = parseModulePermissions(user.modulePermissions);
  const mod = (key: Parameters<typeof canAccessModule>[2], defaultFn: (r: string) => boolean) =>
    canAccessModule(user.role, mods, key, defaultFn);

  const canSeeDashboard    = canAccessDashboard(user.role);
  const canSeeVehicles     = mod("vehiculos",    canAccessVehicles);
  const canSeeWorkers      = mod("trabajadores", canAccessTrabajadores);
  const canSeeOperaciones  = mod("operaciones",  canAccessDashboard);
  const canSeeAdministration = canAccessAdministration(user.role);
  const canSeeBiblioteca   = mod("biblioteca",   canAccessBiblioteca);
  const canSeeTareasBasic  = mod("tareas",        canViewTareas);
  const canSeeHSEC         = mod("hsec",          canAccessHSEC);
  const isOfficeRole = user.role === "OFICINA" || user.role === "COLABORADOR";

  const opcionesActivas = ["resumen", "carga", "tareas", "operaciones"] as ShellNavKey[];
  const trabajadoresActivos = ["trabajadores"] as ShellNavKey[];

  const navEntries: NavEntry[] = [
    ...(!isOfficeRole && canSeeDashboard ? [{
      type: "link" as const,
      href: "/dashboard",
      label: "Dashboard",
      navKey: "dashboard",
      active: activeNav === "dashboard",
    }] : []),

    ...(canSeeTareasBasic ? [{
      type: "link" as const,
      href: "/gestion-tareas",
      label: "Tareas",
      navKey: "gestion-tareas",
      active: activeNav === "gestion-tareas",
    }] : []),

    ...(!isOfficeRole && canSeeOperaciones ? [{
      type: "link" as const,
      href: "/operaciones",
      label: "Operaciones",
      navKey: "operaciones",
      active: opcionesActivas.includes(activeNav),
    }] : []),

    ...(canSeeHSEC ? [{
      type: "link" as const,
      href: "/hsec",
      label: "HSEC / Prevención",
      navKey: "hsec",
      active: activeNav === "hsec",
    }] : []),

    ...(!isOfficeRole && canSeeWorkers ? [{
      type: "link" as const,
      href: "/trabajadores",
      label: "Trabajadores",
      navKey: "trabajadores",
      active: trabajadoresActivos.includes(activeNav),
    }] : []),

    ...(!isOfficeRole && canSeeVehicles ? [{
      type: "link" as const,
      href: "/vehiculos",
      label: "Vehículos",
      navKey: "vehiculos",
      active: activeNav === "vehiculos",
    }] : []),

    ...(canSeeBiblioteca ? [{
      type: "link" as const,
      href: "/biblioteca",
      label: "Biblioteca",
      navKey: "biblioteca",
      active: activeNav === "biblioteca",
    }] : []),

    ...(canSeeAdministration ? [{
      type: "link" as const,
      href: "/administracion",
      label: "Administración",
      navKey: "administracion",
      active: activeNav === "administracion",
    }] : []),
  ];

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar-card">
          <Link href="/" aria-label="Ir al inicio" className="dashboard-brand">
            <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={112} height={112} priority />
            <div>
              <strong>Nomade Control</strong>
            </div>
          </Link>

          <NavMenu items={navEntries} />

          <div className="dashboard-sidebar-footer">
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
            <Link href="/mi-perfil" style={{ textDecoration: "none" }}>
              <div className="dashboard-user" style={{ cursor: "pointer" }} title="Mi perfil">{user.name}</div>
            </Link>
          </div>
        </div>

        {children}
      </section>
    </main>
  );
}
