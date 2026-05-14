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

  const VALID_ACCESS_ROLES = ["SUPERVISOR", "OPERADOR", "RRHH", "OFICINA", "COLABORADOR", "VEHICULOS", "ADMIN_LIMITADO", "ADMINISTRADOR"];
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

  // Validar que el tipo de acceso seleccionado coincida con el rol real del usuario
  if (accessRole === "ADMINISTRADOR" && !isAdminRole(user.role)) {
    return { error: "Este usuario no tiene perfil de administrador." };
  }
  if (accessRole === "ADMIN_LIMITADO" && user.role !== "ADMIN_LIMITADO") {
    return { error: "Este usuario no tiene perfil de admin limitado." };
  }
  if (accessRole === "SUPERVISOR" && !isSupervisorRole(user.role)) {
    return { error: "Este usuario no tiene perfil de supervisor." };
  }
  if (accessRole === "OPERADOR" && user.role !== "OPERADOR") {
    return { error: "Este usuario no tiene perfil de operador." };
  }
  if (accessRole === "RRHH" && user.role !== "RRHH") {
    return { error: "Este usuario no tiene perfil de Recursos Humanos." };
  }
  if (accessRole === "OFICINA" && user.role !== "OFICINA") {
    return { error: "Este usuario no tiene perfil de oficina." };
  }
  if (accessRole === "VEHICULOS" && user.role !== "VEHICULOS") {
    return { error: "Este usuario no tiene perfil de vehículos." };
  }
  if (accessRole === "COLABORADOR" && user.role !== "COLABORADOR") {
    return { error: "Este usuario no tiene perfil de colaborador." };
  }

  await createSession(user.id);
  redirect(defaultRouteForRole(user.role));
}
