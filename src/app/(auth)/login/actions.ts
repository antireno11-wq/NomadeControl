"use server";

import { redirect } from "next/navigation";
import { createSession, defaultRouteForRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";

export async function loginAction(_: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Correo y contraseña son obligatorios." };
  }

  const user = await db.user.findUnique({ where: { email } });

  if (!user) {
    return { error: "Credenciales inválidas." };
  }

  const validPassword = await verifyPassword(password, user.passwordHash);

  if (!validPassword) {
    return { error: "Credenciales inválidas." };
  }

  await createSession(user.id);
  redirect(defaultRouteForRole(user.role));
}
