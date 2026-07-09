import Link from "next/link";
import { getCurrentUser, canAccessDashboard, canAccessCampOperations, canAccessVehicles, canAccessBiblioteca, canViewTareas, canAccessAdministration, canAccessTrabajadores } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { ENABLED_MODULES } from "@/lib/modules-config";

type Module = {
  key: string;
  href: string;
  icon: string;
  title: string;
  description: string;
  color: string;
};

const DISABLED_MODULE_LABEL: Record<string, string> = {
  dashboard: "Dashboard",
  tareas: "Gestión de tareas",
  hsec: "HSEC / Prevención",
  biblioteca: "Biblioteca",
};

export default async function HomePage({
  searchParams,
}: {
  searchParams?: { moduloDeshabilitado?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const modules: Module[] = [
    ...(ENABLED_MODULES.trabajadores && canAccessTrabajadores(user.role) ? [{
      key: "control-documental",
      href: "/trabajadores/control-documental",
      icon: "📄",
      title: "Control documental",
      description: "Vencimientos de documentos del personal — vigencias, alertas y estado",
      color: "#0369a1",
    }] : []),
    ...(ENABLED_MODULES.vehiculos && canAccessVehicles(user.role) ? [{
      key: "vehiculos",
      href: "/vehiculos",
      icon: "🚗",
      title: "Vehículos",
      description: "Control de flota, checklists y documentos",
      color: "#7c3aed",
    }] : []),
    ...(ENABLED_MODULES.operaciones && canAccessCampOperations(user.role) ? [{
      key: "campamentos",
      href: "/operaciones?vista=campamentos",
      icon: "🏕️",
      title: "Campamentos",
      description: "Campamentos activos, cierre con resumen y gráficos",
      color: "#006878",
    }] : []),
    ...(ENABLED_MODULES.dashboard && canAccessDashboard(user.role) ? [{
      key: "dashboard",
      href: "/dashboard",
      icon: "📊",
      title: "Dashboard",
      description: "Resumen operacional general",
      color: "#006878",
    }] : []),
    ...(ENABLED_MODULES.tareas && canViewTareas(user.role) ? [{
      key: "tareas",
      href: "/gestion-tareas",
      icon: "✅",
      title: "Gestión de Tareas",
      description: "Compromisos, pendientes y seguimiento de tareas",
      color: "#059669",
    }] : []),
    ...(ENABLED_MODULES.biblioteca && canAccessBiblioteca(user.role) ? [{
      key: "biblioteca",
      href: "/biblioteca",
      icon: "📚",
      title: "Biblioteca",
      description: "Documentos, procedimientos y archivos compartidos",
      color: "#d97706",
    }] : []),
    ...(ENABLED_MODULES.administracion && canAccessAdministration(user.role) ? [{
      key: "administracion",
      href: "/administracion",
      icon: "⚙️",
      title: "Administración",
      description: "Usuarios, campamentos, configuración y auditoría",
      color: "#dc2626",
    }] : []),
  ];

  const moduloDeshab = searchParams?.moduloDeshabilitado;
  const deshabLabel = moduloDeshab ? DISABLED_MODULE_LABEL[moduloDeshab] : null;

  const hora = new Date().getHours();
  const saludo = hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <AppShell title="Inicio" user={{ name: user.name, role: user.role }} activeNav={null}>
      {/* Welcome */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "var(--teal)" }}>
          {saludo}, {user.name.split(" ")[0]} 👋
        </h2>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: "0.95rem" }}>
          ¿A qué módulo querés acceder hoy?
        </p>
      </div>

      {deshabLabel && (
        <div style={{
          marginBottom: 20, padding: "10px 14px", borderRadius: 10,
          background: "#fef3c7", border: "1px solid #fde68a",
          color: "#854d0e", fontSize: "0.88rem",
        }}>
          ⏸ El módulo <strong>{deshabLabel}</strong> está temporalmente deshabilitado.
        </div>
      )}

      {/* Module cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 16,
      }}>
        {modules.map(mod => (
          <Link key={mod.key} href={mod.href} style={{ textDecoration: "none" }}>
            <div className="card" style={{
              padding: "22px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              cursor: "pointer",
              borderLeft: `4px solid ${mod.color}`,
              transition: "transform 0.15s, box-shadow 0.15s",
            }}
              onMouseEnter={undefined}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{
                  fontSize: "2rem",
                  background: `${mod.color}18`,
                  borderRadius: 12,
                  width: 52,
                  height: 52,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {mod.icon}
                </span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "1.05rem", color: mod.color }}>
                    {mod.title}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>
                    {mod.description}
                  </div>
                </div>
              </div>
              <div style={{
                fontSize: "0.8rem",
                fontWeight: 700,
                color: mod.color,
                textAlign: "right",
                marginTop: 4,
              }}>
                Abrir →
              </div>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
