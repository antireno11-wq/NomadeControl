import type { SectionTab } from "@/components/section-tabs";
import { canAccessAdministration } from "@/lib/auth";

/**
 * Sub-navegación del módulo Operaciones.
 * Simplificado: solo "Campamentos" (activos) + "Cerrados" (admin).
 * Los tabs de Estado hoy/Histórico/Informe diario/Control tareas están
 * deshabilitados (ver lib/modules-config.ts) pero sus rutas siguen
 * accesibles por URL directa.
 */
export function buildOperacionesTabs(role: string, activeKey:
  | "hoy"
  | "historico"
  | "cerrados"
  | "carga-diaria"
  | "control-tareas"
  | "campamentos"
): SectionTab[] {
  const canSeeAdmin = canAccessAdministration(role);

  return [
    { href: "/operaciones?vista=campamentos", label: "Campamentos activos", active: activeKey === "campamentos" || activeKey === "hoy" },
    ...(canSeeAdmin ? [{ href: "/operaciones?vista=cerrados", label: "Campamentos cerrados", active: activeKey === "cerrados" }] : []),
  ];
}

/**
 * Sub-navegación del módulo Trabajadores.
 * Simplificado: solo "Trabajadores" (lista) + "Control documental".
 * Los tabs de Capacitaciones/Control EPP/Ex trabajadores están
 * deshabilitados; sus rutas siguen accesibles por URL directa.
 */
export function buildTrabajadoresTabs(activeKey:
  | "trabajadores"
  | "control-documental"
  | "dashboard"
  | "capacitaciones"
  | "epp"
  | "ex"
): SectionTab[] {
  return [
    { href: "/trabajadores/control-documental/dashboard", label: "📊 Dashboard", active: activeKey === "dashboard" },
    { href: "/trabajadores/control-documental", label: "📄 Control documental", active: activeKey === "control-documental" },
    { href: "/trabajadores", label: "Lista de trabajadores", active: activeKey === "trabajadores" },
  ];
}
