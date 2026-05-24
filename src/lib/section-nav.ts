import type { SectionTab } from "@/components/section-tabs";
import { canAccessAdministration, canAccessCampOperations } from "@/lib/auth";

/**
 * Sub-navegación del módulo Operaciones.
 * - `activeKey`: identifica cuál tab debe quedar marcada
 * - `role`: rol del usuario, controla qué tabs son visibles
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
  const canSeeCampOps = canAccessCampOperations(role) && !canSeeAdmin;

  return [
    { href: "/operaciones", label: "Estado hoy", active: activeKey === "hoy" },
    { href: "/operaciones?vista=historico", label: "Histórico", active: activeKey === "historico" },
    ...(canSeeAdmin ? [{ href: "/operaciones?vista=cerrados", label: "Cerrados", active: activeKey === "cerrados" }] : []),
    ...(canSeeCampOps ? [
      { href: "/carga-diaria", label: "Informe diario", active: activeKey === "carga-diaria" },
      { href: "/control-tareas-diarias", label: "Control tareas", active: activeKey === "control-tareas" },
    ] : []),
    ...(canSeeAdmin ? [
      { href: "/administracion?seccion=campamentos", label: "Campamentos", active: activeKey === "campamentos" },
    ] : []),
  ];
}

/**
 * Sub-navegación del módulo Trabajadores.
 */
export function buildTrabajadoresTabs(activeKey:
  | "trabajadores"
  | "capacitaciones"
  | "epp"
  | "ex"
): SectionTab[] {
  return [
    { href: "/trabajadores", label: "Trabajadores", active: activeKey === "trabajadores" },
    { href: "/trabajadores/inducciones", label: "Capacitaciones", active: activeKey === "capacitaciones" },
    { href: "/trabajadores/epp", label: "Control EPP", active: activeKey === "epp" },
    { href: "/trabajadores/ex-trabajadores", label: "Ex trabajadores", active: activeKey === "ex" },
  ];
}
