import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "camp_session";
const SESSION_TTL_DAYS = 7;

// ─── Sistema de roles simplificado a 3 niveles ─────────────────────────────
// Administrador → todo (usuarios, config, todo el operativo)
// Operativo    → crea/edita en Personal + Vehículos + Campamentos, no toca usuarios
// Consulta     → solo lectura
//
// Los valores antiguos (RRHH, SUPERVISOR, ADMIN, ADMIN_LIMITADO, etc.) siguen
// funcionando gracias a `normalizeRole()`: si un usuario existente tiene
// rol="RRHH", el sistema lo trata como "OPERATIVO" sin necesidad de migrar
// la BD. Al editar el usuario, se persiste con el nombre nuevo.
export type AppRole = "ADMINISTRADOR" | "OPERATIVO" | "CONSULTA";

export const MANAGED_USER_ROLE_VALUES = ["ADMINISTRADOR", "OPERATIVO", "CONSULTA"] as const;

export const ROLE_LABEL: Record<AppRole, string> = {
  ADMINISTRADOR: "Administrador",
  OPERATIVO:     "Operativo",
  CONSULTA:      "Consulta",
};

export const ROLE_DESCRIPTION: Record<AppRole, string> = {
  ADMINISTRADOR: "Todo: gestión de usuarios, configuración, campamentos, personal, vehículos, borrar cosas",
  OPERATIVO:     "Crea/edita en Personal, Vehículos y Campamentos. No gestiona usuarios ni config",
  CONSULTA:      "Solo lectura de todos los paneles y fichas",
};

// Mapeo de roles legacy → nuevos. Se aplica en memoria al leer el usuario.
const LEGACY_ROLE_MAP: Record<string, AppRole> = {
  ADMIN:           "ADMINISTRADOR",
  ADMIN_LIMITADO:  "ADMINISTRADOR",
  RRHH:            "OPERATIVO",
  SUPERVISOR:      "OPERATIVO",
  OPERADOR:        "OPERATIVO",
  VEHICULOS:       "OPERATIVO",
  OFICINA:         "CONSULTA",
  COLABORADOR:     "CONSULTA",
};

export function normalizeRole(role: string): AppRole {
  if (role === "ADMINISTRADOR" || role === "OPERATIVO" || role === "CONSULTA") {
    return role;
  }
  return LEGACY_ROLE_MAP[role] ?? "CONSULTA";
}

// Constantes de listas de roles — se mantienen los nombres viejos por
// compatibilidad con requireRole(ADMIN_ROLES) etc., pero el chequeo interno
// ya normaliza. Todos apuntan a los nuevos valores.
export const FULL_ADMIN_ROLES: AppRole[] = ["ADMINISTRADOR"];
export const ADMIN_ROLES: AppRole[] = ["ADMINISTRADOR"];
export const VEHICLE_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];
export const OPERATION_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];
export const TRABAJADORES_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];
export const PROFILE_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO", "CONSULTA"];
export const SUPERVISOR_ROLES: AppRole[] = ["OPERATIVO"];
export const BIBLIOTECA_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO", "CONSULTA"];
export const TAREAS_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];
export const TAREAS_VER_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO", "CONSULTA"];
export const EVALUACIONES_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];
export const HSEC_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

export function defaultRouteForRole(role: string) {
  const norm = normalizeRole(role);
  if (norm === "CONSULTA") return "/trabajadores/control-documental";
  return "/";
}

export function isAdminRole(role: string) {
  return normalizeRole(role) === "ADMINISTRADOR";
}

export function isFullAdminRole(role: string) {
  return normalizeRole(role) === "ADMINISTRADOR";
}

// isSupervisorRole quedó legacy pero algunos endpoints lo usan para
// distinguir roles operativos con restricción por campamento. Ahora los
// operativos ven todos los campamentos (transversal). Devolvemos false
// para desactivar cualquier restricción de scope-por-camp.
export function isSupervisorRole(_role: string) {
  return false;
}

export function isVehicleOnlyRole(_role: string) {
  return false;
}

/**
 * DdD. Por defecto solo lo ve quien administra: las reuniones de gerencia no
 * son asunto de un supervisor de campamento. A quien deba verlas se le marca
 * el módulo "Compromisos y minutas" en su usuario.
 */
export function canAccessDdd(role: string) {
  return isAdminRole(role);
}

/**
 * Puerta de entrada al DdD, para las páginas y no solo para el menú: ocultar
 * un enlace no protege nada si la URL sigue abierta.
 */
export async function requireDdd() {
  const user = await requireRole(TRABAJADORES_ROLES);
  const permisos = parseModulePermissions((user as { modulePermissions?: unknown }).modulePermissions);
  if (!canAccessModule(user.role, permisos, "ddd", canAccessDdd)) {
    redirect("/?moduloDeshabilitado=ddd");
  }
  return user;
}

export function canAccessAdministration(role: string) {
  return normalizeRole(role) === "ADMINISTRADOR";
}

export function canAccessDashboard(role: string) {
  const norm = normalizeRole(role);
  return norm === "ADMINISTRADOR" || norm === "OPERATIVO";
}

export function canAccessCampOperations(role: string) {
  const norm = normalizeRole(role);
  return norm === "ADMINISTRADOR" || norm === "OPERATIVO";
}

export function canAccessVehicles(role: string) {
  const norm = normalizeRole(role);
  return norm === "ADMINISTRADOR" || norm === "OPERATIVO";
}

export function canAccessBiblioteca(role: string) {
  return true; // los 3 niveles ven biblioteca cuando está habilitada
}

export function canAccessTareas(role: string) {
  const norm = normalizeRole(role);
  return norm === "ADMINISTRADOR" || norm === "OPERATIVO";
}

export function canManageTareas(role: string) {
  const norm = normalizeRole(role);
  return norm === "ADMINISTRADOR" || norm === "OPERATIVO";
}

export function canViewTareas(_role: string) {
  return true; // los 3 niveles ven tareas cuando está habilitado
}

export function canAccessEvaluaciones(role: string) {
  const norm = normalizeRole(role);
  return norm === "ADMINISTRADOR" || norm === "OPERATIVO";
}

export function canAccessHSEC(role: string) {
  const norm = normalizeRole(role);
  return norm === "ADMINISTRADOR" || norm === "OPERATIVO";
}

export function canAccessTrabajadores(_role: string) {
  return true; // los 3 niveles ven trabajadores (consulta = solo lectura)
}

// ── Permisos por módulo ──────────────────────────────────────────────────────
export const ALL_MODULES = [
  { key: "operaciones",  label: "Operaciones",       description: "Dashboard de campamentos e histórico" },
  { key: "tareas",       label: "Tareas",             description: "Gestión de tareas" },
  { key: "hsec",         label: "HSEC / Prevención",  description: "Incidentes y matrices de riesgo" },
  { key: "trabajadores", label: "Trabajadores",       description: "Inducciones y Control EPP" },
  { key: "bodega",       label: "Bodega",             description: "Stock y movimientos de bodega" },
  { key: "vehiculos",    label: "Vehículos",          description: "Control vehicular" },
  { key: "biblioteca",   label: "Biblioteca",         description: "Documentos y recursos" },
  { key: "ddd",          label: "Compromisos y minutas", description: "Diálogo de Desempeño: reuniones, compromisos y minutas" },
] as const;

export type ModuleKey = typeof ALL_MODULES[number]["key"];

/** Parsea el campo modulePermissions (Json) a string[]. Vacío = sin restricciones. */
export function parseModulePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

/**
 * Retorna true si el usuario puede ver el módulo dado.
 * - Admins: siempre true
 * - Si modulePermissions está vacío: usa los defaults del rol
 * - Si tiene items: solo esos módulos están habilitados
 */
export function canAccessModule(
  role: string,
  modulePermissions: string[],
  module: ModuleKey,
  defaultCheck: (role: string) => boolean
): boolean {
  if (isAdminRole(role)) return true;
  if (modulePermissions.length === 0) return defaultCheck(role);
  return modulePermissions.includes(module);
}

export function roleLabel(role: string) {
  return ROLE_LABEL[normalizeRole(role)];
}

function sessionExpirationDate() {
  const date = new Date();
  date.setDate(date.getDate() + SESSION_TTL_DAYS);
  return date;
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = sessionExpirationDate();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true }
  });

  await db.session.create({
    data: {
      token,
      userId,
      expiresAt
    }
  });

  cookies().set({
    name: SESSION_COOKIE_NAME,
    value: token,
    expires: expiresAt,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
      path: "/"
  });

  if (user) {
    await logAuditEvent({
      actorUserId: user.id,
      actorName: user.name,
      actorEmail: user.email,
      action: "LOGIN",
      entityType: "session",
      entityId: token,
      summary: "Inicio de sesión"
    });
  }
}

export async function clearSession() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    const session = await db.session.findUnique({
      where: { token },
      include: { user: { select: { id: true, name: true, email: true } } }
    });

    await db.session.deleteMany({ where: { token } });

    if (session?.user) {
      await logAuditEvent({
        actorUserId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: "LOGOUT",
        entityType: "session",
        entityId: token,
        summary: "Cierre de sesión"
      });
    }
  }

  cookies().delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { token },
    include: { user: true }
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { token } });
    cookies().delete(SESSION_COOKIE_NAME);
    return null;
  }

  if (!session.user.isActive) {
    await db.session.delete({ where: { token } });
    cookies().delete(SESSION_COOKIE_NAME);
    return null;
  }

  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireRole(allowed: AppRole[]) {
  const user = await requireUser();
  const norm = normalizeRole(user.role);
  if (!allowed.includes(norm)) {
    redirect(defaultRouteForRole(user.role));
  }
  return user;
}
