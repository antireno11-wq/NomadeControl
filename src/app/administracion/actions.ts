"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendWelcomeEmail } from "@/lib/mailer";

const createUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["ADMINISTRADOR", "SUPERVISOR"]),
  campId: z.string().optional(),
  password: z.string().min(8),
  sendWelcomeEmail: z.string().optional()
});

const updateUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(2),
  role: z.enum(["ADMINISTRADOR", "SUPERVISOR"]),
  campId: z.string().optional(),
  isActive: z.string().optional()
});

const resetPasswordSchema = z.object({
  userId: z.string().min(1),
  newPassword: z.string().min(8)
});

function normalizedCampIdForRole(role: "ADMINISTRADOR" | "SUPERVISOR", campId?: string) {
  if (role === "ADMINISTRADOR") return null;
  return campId && campId !== "none" ? campId : null;
}

export async function createUserAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    campId: formData.get("campId"),
    password: formData.get("password"),
    sendWelcomeEmail: formData.get("sendWelcomeEmail")
  });

  if (!parsed.success) {
    throw new Error("Datos inválidos para crear usuario.");
  }

  const payload = parsed.data;
  const existing = await db.user.findUnique({ where: { email: payload.email } });
  if (existing) {
    throw new Error("Ya existe un usuario con ese correo.");
  }

  let campName: string | null = null;
  const campId = normalizedCampIdForRole(payload.role, payload.campId);
  if (campId) {
    const camp = await db.camp.findUnique({ where: { id: campId } });
    campName = camp?.name ?? null;
  }

  const passwordHash = await bcrypt.hash(payload.password, 10);

  const createdUser = await db.user.create({
    data: {
      name: payload.name,
      email: payload.email,
      role: payload.role,
      campId,
      isActive: true,
      passwordHash
    }
  });

  if (payload.sendWelcomeEmail === "on") {
    try {
      await sendWelcomeEmail({
        to: payload.email,
        name: payload.name,
        role: payload.role,
        password: payload.password,
        campName
      });
    } catch (error) {
      await db.user.delete({ where: { id: createdUser.id } });
      throw error;
    }
  }

  revalidatePath("/administracion");
  redirect("/administracion/usuarios/nuevo?ok=1");
}

export async function updateUserAccessAction(formData: FormData) {
  const currentUser = await requireRole(ADMIN_ROLES);

  const parsed = updateUserSchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    role: formData.get("role"),
    campId: formData.get("campId"),
    isActive: formData.get("isActive")
  });

  if (!parsed.success) {
    throw new Error("Datos inválidos para actualizar usuario.");
  }

  const payload = parsed.data;
  const willDeactivate = payload.isActive !== "on";

  if (payload.userId === currentUser.id && willDeactivate) {
    throw new Error("No puedes desactivar tu propio usuario.");
  }

  await db.user.update({
    where: { id: payload.userId },
    data: {
      name: payload.name,
      role: payload.role,
      isActive: payload.isActive === "on",
      campId: normalizedCampIdForRole(payload.role, payload.campId)
    }
  });

  revalidatePath("/administracion");
}

export async function resetUserPasswordAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    newPassword: formData.get("newPassword")
  });

  if (!parsed.success) {
    throw new Error("Contraseña inválida.");
  }

  const payload = parsed.data;
  const passwordHash = await bcrypt.hash(payload.newPassword, 10);

  await db.user.update({
    where: { id: payload.userId },
    data: { passwordHash }
  });

  revalidatePath("/administracion");
}
