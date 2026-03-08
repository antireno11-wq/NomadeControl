"use server";

import { redirect } from "next/navigation";
import { createSession, defaultRouteForRole, isAdminRole, isSupervisorRole, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";

export async function loginAction(_: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const accessRole = String(formData.get("accessRole") ?? "").trim().toUpperCase();

  if (!email || !password || !accessRole) {
    return { error: "Tipo de acceso, correo y contraseña son obligatorios." };
  }

  if (accessRole !== "SUPERVISOR" && accessRole !== "ADMINISTRADOR") {
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

  if (accessRole === "ADMINISTRADOR" && !isAdminRole(user.role)) {
    return { error: "Este usuario no tiene perfil de administrador." };
  }

  if (accessRole === "SUPERVISOR" && !isSupervisorRole(user.role)) {
    return { error: "Este usuario no tiene perfil de supervisor." };
  }

  await createSession(user.id);
  redirect(defaultRouteForRole(user.role));
}
