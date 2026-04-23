import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "camp_session";
const SESSION_TTL_DAYS = 7;
export type AppRole =
  | "ADMINISTRADOR"
  | "ADMIN_LIMITADO"
  | "SUPERVISOR"
  | "VEHICULOS"
  | "ADMIN"
  | "OPERADOR";
export const MANAGED_USER_ROLE_VALUES = ["SUPERVISOR", "ADMINISTRADOR", "ADMIN_LIMITADO", "VEHICULOS"] as const;
export const FULL_ADMIN_ROLES: AppRole[] = ["ADMINISTRADOR", "ADMIN"];
export const ADMIN_ROLES: AppRole[] = [...FULL_ADMIN_ROLES, "ADMIN_LIMITADO"];
export const VEHICLE_ROLES: AppRole[] = [...ADMIN_ROLES, "VEHICULOS"];
export const OPERATION_ROLES: AppRole[] = [...ADMIN_ROLES, "SUPERVISOR", "OPERADOR"];
export const PROFILE_ROLES: AppRole[] = [...VEHICLE_ROLES, "SUPERVISOR", "OPERADOR"];
export const SUPERVISOR_ROLES: AppRole[] = ["SUPERVISOR", "OPERADOR"];
export const BIBLIOTECA_ROLES: AppRole[] = [...ADMIN_ROLES, "SUPERVISOR", "OPERADOR"];
export const TAREAS_ROLES: AppRole[]     = [...ADMIN_ROLES, "SUPERVISOR", "OPERADOR"];

export function defaultRouteForRole(role: string) {
  if (isVehicleOnlyRole(role)) {
    return "/vehiculos";
  }

  if (canAccessDashboard(role)) {
    return "/dashboard";
  }

  return "/carga-diaria";
}

export function isAdminRole(role: string) {
  return ADMIN_ROLES.includes(role as AppRole);
}

export function isFullAdminRole(role: string) {
  return FULL_ADMIN_ROLES.includes(role as AppRole);
}

export function isSupervisorRole(role: string) {
  return role === "SUPERVISOR" || role === "OPERADOR";
}

export function isVehicleOnlyRole(role: string) {
  return role === "VEHICULOS";
}

export function canAccessAdministration(role: string) {
  return isAdminRole(role);
}

export function canAccessDashboard(role: string) {
  return OPERATION_ROLES.includes(role as AppRole);
}

export function canAccessCampOperations(role: string) {
  return OPERATION_ROLES.includes(role as AppRole);
}

export function canAccessVehicles(role: string) {
  return VEHICLE_ROLES.includes(role as AppRole);
}

export function canAccessBiblioteca(role: string) {
  return BIBLIOTECA_ROLES.includes(role as AppRole);
}

export function canAccessTareas(role: string) {
  return TAREAS_ROLES.includes(role as AppRole);
}

export function roleLabel(role: string) {
  if (role === "ADMIN" || role === "ADMINISTRADOR") return "ADMINISTRADOR";
  if (role === "ADMIN_LIMITADO") return "ADMIN LIMITADO";
  if (role === "VEHICULOS") return "SOLO VEHÍCULOS";
  return role;
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

  if (!allowed.includes(user.role as AppRole)) {
    redirect(defaultRouteForRole(user.role));
  }

  return user;
}
