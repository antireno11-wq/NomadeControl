"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

const profileSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().trim().optional(),
  positionTitle: z.string().trim().optional(),
  profilePhotoUrl: z.string().trim().url().or(z.literal("")).optional(),
  emergencyContactName: z.string().trim().optional(),
  emergencyContactPhone: z.string().trim().optional(),
  nationalId: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  healthProvider: z.string().trim().optional(),
  shiftPattern: z.enum(["", "14x14", "10x10", "7x7", "4x3"]).optional(),
  shiftStartDate: z.string().trim().optional()
});

const shiftRules = {
  "14x14": { work: 14, off: 14 },
  "10x10": { work: 10, off: 10 },
  "7x7": { work: 7, off: 7 },
  "4x3": { work: 4, off: 3 }
} as const;

export type ProfileFormState = { error: string; success: string };
export type PasswordFormState = { error: string; success: string };

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8)
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "La nueva contraseña y la confirmación no coinciden.",
    path: ["confirmPassword"]
  });

export async function saveProfileAction(_: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await requireRole(OPERATION_ROLES);

  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    phone: String(formData.get("phone") ?? ""),
    positionTitle: String(formData.get("positionTitle") ?? ""),
    profilePhotoUrl: String(formData.get("profilePhotoUrl") ?? ""),
    emergencyContactName: String(formData.get("emergencyContactName") ?? ""),
    emergencyContactPhone: String(formData.get("emergencyContactPhone") ?? ""),
    nationalId: String(formData.get("nationalId") ?? ""),
    address: String(formData.get("address") ?? ""),
    city: String(formData.get("city") ?? ""),
    healthProvider: String(formData.get("healthProvider") ?? ""),
    shiftPattern: String(formData.get("shiftPattern") ?? ""),
    shiftStartDate: String(formData.get("shiftStartDate") ?? "")
  });

  if (!parsed.success) {
    return { error: "Verifica los datos del perfil.", success: "" };
  }

  const payload = parsed.data;
  const normalizedShiftPattern = payload.shiftPattern || null;
  const shiftRule = normalizedShiftPattern ? shiftRules[normalizedShiftPattern as keyof typeof shiftRules] : null;
  const shiftStartDate = normalizedShiftPattern && payload.shiftStartDate ? new Date(`${payload.shiftStartDate}T00:00:00.000Z`) : null;

  await db.user.update({
    where: { id: user.id },
    data: {
      name: payload.name,
      phone: payload.phone || null,
      positionTitle: payload.positionTitle || null,
      profilePhotoUrl: payload.profilePhotoUrl || null,
      emergencyContactName: payload.emergencyContactName || null,
      emergencyContactPhone: payload.emergencyContactPhone || null,
      nationalId: payload.nationalId || null,
      address: payload.address || null,
      city: payload.city || null,
      healthProvider: payload.healthProvider || null,
      shiftPattern: normalizedShiftPattern,
      shiftWorkDays: shiftRule?.work ?? null,
      shiftOffDays: shiftRule?.off ?? null,
      shiftStartDate
    }
  });

  revalidatePath("/mi-perfil");
  return { error: "", success: "Perfil actualizado correctamente." };
}

export async function changeOwnPasswordAction(
  _: PasswordFormState,
  formData: FormData
): Promise<PasswordFormState> {
  const user = await requireRole(OPERATION_ROLES);

  const parsed = passwordSchema.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? "")
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Verifica la nueva contraseña.", success: "" };
  }

  const isCurrentPasswordValid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!isCurrentPasswordValid) {
    return { error: "La contraseña actual no es correcta.", success: "" };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash }
  });

  revalidatePath("/mi-perfil");
  return { error: "", success: "Contraseña actualizada correctamente." };
}
