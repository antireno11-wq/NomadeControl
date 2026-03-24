import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { logoutAction } from "@/app/dashboard/actions";
import { NotificationBell } from "@/components/notification-bell";

type ShellNavKey = "dashboard" | "carga" | "tareas" | "administracion" | null;

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
  const navItems = [
    { href: "/dashboard", label: "Dashboard", key: "dashboard" as const },
    ...(!showAdminSections
      ? [
          { href: "/carga-diaria", label: "Informe diario", key: "carga" as const },
          { href: "/control-tareas-diarias", label: "Control tareas", key: "tareas" as const }
        ]
      : []),
    ...(showAdminSections ? [{ href: "/administracion", label: "Administración", key: "administracion" as const }] : [])
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
