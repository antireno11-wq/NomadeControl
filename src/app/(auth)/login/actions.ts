"use server";

import { redirect } from "next/navigation";
import { createSession, defaultRouteForRole, isAdminRole, isSupervisorRole, isVehicleOnlyRole, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";

export async function loginAction(_: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const accessRole = String(formData.get("accessRole") ?? "").trim().toUpperCase();

  if (!email || !password || !accessRole) {
    return { error: "Tipo de acceso, correo y contraseña son obligatorios." };
  }

  if (!["SUPERVISOR", "ADMINISTRADOR", "ADMIN_LIMITADO", "VEHICULOS", "OFICINA", "COLABORADOR"].includes(accessRole)) {
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

  if (accessRole === "VEHICULOS" && !isVehicleOnlyRole(user.role)) {
    return { error: "Este usuario no tiene perfil solo vehículos." };
  }

  if (accessRole === "OFICINA" && user.role !== "OFICINA") {
    return { error: "Este usuario no tiene perfil de oficina." };
  }

  if (accessRole === "COLABORADOR" && user.role !== "COLABORADOR") {
    return { error: "Este usuario no tiene perfil de colaborador." };
  }

  await createSession(user.id);
  redirect(defaultRouteForRole(user.role));
}
