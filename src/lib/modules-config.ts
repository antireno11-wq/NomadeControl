/**
 * Feature flags de módulos.
 *
 * Para reactivar un módulo, cambia el valor a `true` en este archivo.
 * Es un toggle simple, sin necesidad de variables de entorno.
 *
 * Los módulos deshabilitados:
 *  - Se ocultan del menú lateral
 *  - Sus sub-tabs no aparecen en las páginas restantes
 *  - Sus rutas siguen técnicamente accesibles por URL directa (para admins
 *    que necesiten revisar data histórica), pero no están visibles en la UI
 */
export const ENABLED_MODULES = {
  dashboard:      false,   // /dashboard — resumen general
  tareas:         false,   // /gestion-tareas — gestión de tareas / Asana
  operaciones:    true,    // /operaciones — solo para control de campamentos
  hsec:           false,   // /hsec — HSEC / Prevención
  trabajadores:   true,    // /trabajadores — solo lista + control documental
  vehiculos:      true,    // /vehiculos — flota completa
  biblioteca:     false,   // /biblioteca — documentos compartidos
  administracion: true,    // /administracion — CRUD de camps, usuarios, proyectos
} as const;

export type ModuleKey = keyof typeof ENABLED_MODULES;

export function isModuleEnabled(key: ModuleKey): boolean {
  return ENABLED_MODULES[key];
}
