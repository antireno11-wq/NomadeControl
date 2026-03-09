"use server";

import { revalidatePath } from "next/cache";
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
  healthProvider: z.string().trim().optional()
});

export type ProfileFormState = { error: string; success: string };

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
    healthProvider: String(formData.get("healthProvider") ?? "")
  });

  if (!parsed.success) {
    return { error: "Verifica los datos del perfil.", success: "" };
  }

  const payload = parsed.data;

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
      healthProvider: payload.healthProvider || null
    }
  });

  revalidatePath("/mi-perfil");
  return { error: "", success: "Perfil actualizado correctamente." };
}
