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

const deleteUserSchema = z.object({
  userId: z.string().min(1)
});

const createCampSchema = z.object({
  name: z.string().trim().min(2),
  location: z.string().trim().optional(),
  capacityPeople: z.coerce.number().int().min(0)
});

const updateCampSchema = z.object({
  campId: z.string().min(1),
  name: z.string().trim().min(2),
  location: z.string().trim().optional(),
  capacityPeople: z.coerce.number().int().min(0),
  isActive: z.string().optional()
});

const deleteCampSchema = z.object({
  campId: z.string().min(1)
});

const deleteRecordSchema = z.object({
  recordType: z.enum(["dailyReport", "dailyTaskControl", "stockMovement", "staffMember"]),
  recordId: z.string().min(1)
});

function normalizedCampIdForRole(role: "ADMINISTRADOR" | "SUPERVISOR", campId?: string) {
  if (role === "ADMINISTRADOR") return null;
  return campId && campId !== "none" ? campId : null;
}

export type CreateUserFormState = {
  error: string;
  success: string;
};

function isNextRedirectError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: string }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function createUserAction(
  _: CreateUserFormState,
  formData: FormData
): Promise<CreateUserFormState> {
  try {
    await requireRole(ADMIN_ROLES);

    const parsed = createUserSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
      campId: formData.get("campId"),
      password: formData.get("password"),
      sendWelcomeEmail: formData.get("sendWelcomeEmail")
    });

    if (!parsed.success) return { error: "Datos inválidos para crear usuario.", success: "" };

    const payload = parsed.data;
    const existing = await db.user.findUnique({ where: { email: payload.email } });
    if (existing) {
      return { error: "Ya existe un usuario con ese correo.", success: "" };
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

    let successMessage = "Usuario creado correctamente.";

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
        const mailErrorMessage = error instanceof Error ? error.message : "No se pudo enviar el correo.";
        successMessage = `Usuario creado correctamente. El correo no se envió: ${mailErrorMessage}`;
      }
    }

    revalidatePath("/administracion");
    return { error: "", success: successMessage };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    return { error: error instanceof Error ? error.message : "Error creando usuario.", success: "" };
  }
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
  redirect("/administracion");
}

export async function deleteUserAction(formData: FormData) {
  const currentUser = await requireRole(ADMIN_ROLES);

  const parsed = deleteUserSchema.safeParse({
    userId: formData.get("userId")
  });

  if (!parsed.success) {
    throw new Error("Usuario inválido.");
  }

  const { userId } = parsed.data;

  if (userId === currentUser.id) {
    throw new Error("No puedes borrar tu propio usuario.");
  }

  const targetUser = await db.user.findUnique({
    where: { id: userId },
    include: {
      _count: {
        select: {
          reports: true,
          dailyTaskControls: true,
          stockMovements: true,
          staffMembers: true,
          sessions: true
        }
      }
    }
  });

  if (!targetUser) {
    throw new Error("Usuario no encontrado.");
  }

  await db.session.deleteMany({ where: { userId } });

  const relatedRecordsCount =
    targetUser._count.reports +
    targetUser._count.dailyTaskControls +
    targetUser._count.stockMovements +
    targetUser._count.staffMembers;

  if (relatedRecordsCount === 0) {
    await db.user.delete({ where: { id: userId } });
  } else {
    await db.user.update({
      where: { id: userId },
      data: {
        name: `Usuario eliminado ${targetUser.id.slice(0, 6)}`,
        email: `deleted+${targetUser.id}@nomade.local`,
        isActive: false,
        campId: null,
        phone: null,
        profilePhotoUrl: null,
        positionTitle: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        nationalId: null,
        address: null,
        city: null,
        healthProvider: null
      }
    });
  }

  revalidatePath("/administracion");
}

export async function createCampAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = createCampSchema.safeParse({
    name: formData.get("name"),
    location: String(formData.get("location") ?? ""),
    capacityPeople: formData.get("capacityPeople")
  });

  if (!parsed.success) {
    throw new Error("Datos inválidos para crear campamento.");
  }

  const payload = parsed.data;
  await db.camp.create({
    data: {
      name: payload.name,
      location: payload.location || null,
      capacityPeople: payload.capacityPeople,
      isActive: true
    }
  });

  revalidatePath("/administracion");
  revalidatePath("/dashboard");
  revalidatePath("/carga-diaria");
}

export async function updateCampAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = updateCampSchema.safeParse({
    campId: formData.get("campId"),
    name: formData.get("name"),
    location: String(formData.get("location") ?? ""),
    capacityPeople: formData.get("capacityPeople"),
    isActive: formData.get("isActive")
  });

  if (!parsed.success) {
    throw new Error("Datos inválidos para actualizar campamento.");
  }

  const payload = parsed.data;

  await db.camp.update({
    where: { id: payload.campId },
    data: {
      name: payload.name,
      location: payload.location || null,
      capacityPeople: payload.capacityPeople,
      isActive: payload.isActive === "on"
    }
  });

  revalidatePath("/administracion");
  revalidatePath("/dashboard");
  revalidatePath("/carga-diaria");
  redirect("/administracion?campStatus=updated");
}

export async function deleteCampAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = deleteCampSchema.safeParse({
    campId: formData.get("campId")
  });

  if (!parsed.success) {
    redirect("/administracion?campStatus=invalid");
  }

  const { campId } = parsed.data;

  const camp = await db.camp.findUnique({
    where: { id: campId },
    include: {
      _count: {
        select: {
          users: true,
          reports: true,
          dailyTaskControls: true,
          stockMovements: true,
          inventoryItems: true,
          staffMembers: true
        }
      }
    }
  });

  if (!camp) {
    redirect("/administracion?campStatus=not-found");
  }

  const relatedRecordsCount =
    camp._count.users +
    camp._count.reports +
    camp._count.dailyTaskControls +
    camp._count.stockMovements +
    camp._count.inventoryItems +
    camp._count.staffMembers;

  if (relatedRecordsCount > 0) {
    redirect("/administracion?campStatus=blocked");
  }

  await db.camp.delete({ where: { id: campId } });

  revalidatePath("/administracion");
  revalidatePath("/dashboard");
  revalidatePath("/carga-diaria");
  redirect("/administracion?campStatus=deleted");
}

export async function deleteRecordAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = deleteRecordSchema.safeParse({
    recordType: formData.get("recordType"),
    recordId: formData.get("recordId")
  });

  if (!parsed.success) {
    throw new Error("Registro inválido para borrar.");
  }

  const { recordType, recordId } = parsed.data;

  if (recordType === "dailyReport") {
    await db.dailyReport.delete({ where: { id: recordId } });
    revalidatePath("/dashboard");
    revalidatePath("/carga-diaria");
  }

  if (recordType === "dailyTaskControl") {
    await db.dailyTaskControl.delete({ where: { id: recordId } });
    revalidatePath("/control-tareas-diarias");
  }

  if (recordType === "stockMovement") {
    await db.stockMovement.delete({ where: { id: recordId } });
    revalidatePath("/bodega");
  }

  if (recordType === "staffMember") {
    await db.staffMember.delete({ where: { id: recordId } });
    revalidatePath("/turnos");
  }

  revalidatePath("/administracion");
  revalidatePath("/administracion/registros");
}
