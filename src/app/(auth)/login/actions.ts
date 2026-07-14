"use server";

import { redirect } from "next/navigation";
import { createSession, defaultRouteForRole, normalizeRole, verifyPassword, type AppRole, ROLE_LABEL } from "@/lib/auth";
import { db } from "@/lib/db";

export async function loginAction(_: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const accessRole = String(formData.get("accessRole") ?? "").trim().toUpperCase() as AppRole;

  if (!email || !password || !accessRole) {
    return { error: "Tipo de acceso, correo y contraseña son obligatorios." };
  }

  const VALID_ACCESS_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO", "CONSULTA"];
  if (!VALID_ACCESS_ROLES.includes(accessRole)) {
    return { error: "Selecciona un tipo de acceso válido." };
  }

  const user = await db.user.findUnique({ where: { email } });

  if (!user) {
    return { error: "Credenciales inválidas." };
  }

  if (!user.isActive) {
    return { error: "Tu usuario está inactivo. Contacta al administrador." };
  }

  const validPassword = await verifyPassword(password, user.passwordHash);

  if (!validPassword) {
    return { error: "Credenciales inválidas." };
  }

  // Validar que el tipo de acceso seleccionado coincida con el rol real del
  // usuario. Se compara contra el rol normalizado (los usuarios existentes
  // con roles legacy — RRHH, SUPERVISOR, etc. — se mapean automáticamente).
  const userRoleNorm = normalizeRole(user.role);
  if (accessRole !== userRoleNorm) {
    return {
      error: `Este usuario tiene perfil de "${ROLE_LABEL[userRoleNorm]}". Selecciona ese tipo de acceso.`,
    };
  }

  await createSession(user.id);
  redirect(defaultRouteForRole(user.role));
}
