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
  ddd:            true,    // /compromisos y /reuniones — Diálogo de Desempeño
  administracion: true,    // /administracion — CRUD de camps, usuarios, proyectos
} as const;

export type ModuleKey = keyof typeof ENABLED_MODULES;

export function isModuleEnabled(key: ModuleKey): boolean {
  return ENABLED_MODULES[key];
}

/**
 * Catálogo de módulos que se le pueden marcar a un usuario.
 *
 * Vive acá y no en auth.ts porque el formulario de alta de usuarios es un
 * componente de cliente: importar auth.ts arrastraría bcrypt y la conexión a
 * la base. Estaba duplicado a mano en ese formulario, y por eso el DdD
 * aparecía al editar un usuario pero no al crearlo.
 */
export const ALL_MODULES = [
  { key: "operaciones",  label: "Operaciones",           description: "Dashboard de campamentos e histórico" },
  { key: "tareas",       label: "Tareas",                description: "Gestión de tareas" },
  { key: "hsec",         label: "HSEC / Prevención",     description: "Incidentes y matrices de riesgo" },
  { key: "trabajadores", label: "Trabajadores",          description: "Inducciones y Control EPP" },
  { key: "bodega",       label: "Bodega",                description: "Stock y movimientos de bodega" },
  { key: "vehiculos",    label: "Vehículos",             description: "Control vehicular" },
  { key: "biblioteca",   label: "Biblioteca",            description: "Documentos y recursos" },
  { key: "ddd",          label: "Compromisos y minutas", description: "Diálogo de Desempeño: reuniones, compromisos y minutas" },
] as const;

/**
 * Los que tiene sentido ofrecer. Marcar un módulo apagado no concede nada, y
 * una casilla que no hace nada hace dudar de todas las demás.
 *
 * `ya` son los módulos que el usuario ya tiene: se muestran aunque estén
 * apagados, para que al guardar no se le borren sin que nadie lo pidiera.
 */
export function modulosAsignables(ya: string[] = []) {
  const flags = ENABLED_MODULES as Record<string, boolean | undefined>;
  return ALL_MODULES.filter(m => flags[m.key] !== false || ya.includes(m.key));
}
