"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_ROLES, FULL_ADMIN_ROLES, MANAGED_USER_ROLE_VALUES, isAdminRole, isFullAdminRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendWelcomeEmail } from "@/lib/mailer";
import { geocodeLocation } from "@/lib/weather";

const createUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(MANAGED_USER_ROLE_VALUES),
  campId: z.string().optional(),
  password: z.string().min(8),
  sendWelcomeEmail: z.string().optional()
});

const updateUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(2),
  role: z.enum(MANAGED_USER_ROLE_VALUES),
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
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  capacityPeople: z.coerce.number().int().min(0)
});

const createProjectSchema = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().optional(),
  location: z.string().trim().optional()
});

const updateCampSchema = z.object({
  campId: z.string().min(1),
  name: z.string().trim().min(2),
  location: z.string().trim().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  capacityPeople: z.coerce.number().int().min(0),
  isActive: z.string().optional()
});

const updateCampShiftSchema = z.object({
  campId: z.string().min(1),
  supervisorId: z.string().min(1),
  shiftPattern: z.enum(["14x14", "10x10", "7x7", "4x3"]),
  shiftStartDate: z.string().min(1)
});

const deleteCampSchema = z.object({
  campId: z.string().min(1)
});

const deleteRecordSchema = z.object({
  recordType: z.enum(["dailyReport", "dailyTaskControl", "stockMovement", "staffMember"]),
  recordId: z.string().min(1)
});

function normalizedCampIdForRole(role: (typeof MANAGED_USER_ROLE_VALUES)[number], campId?: string) {
  if (isAdminRole(role)) return null;
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
    const currentUser = await requireRole(ADMIN_ROLES);

    const parsed = createUserSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
      campId: formData.get("campId"),
      password: formData.get("password"),
      sendWelcomeEmail: formData.get("sendWelcomeEmail") ?? undefined
    });

    if (!parsed.success) return { error: "Datos inválidos para crear usuario.", success: "" };

    const payload = parsed.data;
    if (!isFullAdminRole(currentUser.role) && payload.role === "ADMINISTRADOR") {
      return { error: "Tu perfil no puede crear administradores totales.", success: "" };
    }

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

  const targetUser = await db.user.findUnique({
    where: { id: payload.userId },
    select: { role: true }
  });

  if (!targetUser) {
    throw new Error("Usuario no encontrado.");
  }

  if (!isFullAdminRole(currentUser.role)) {
    if (isFullAdminRole(targetUser.role)) {
      throw new Error("Tu perfil no puede modificar administradores totales.");
    }

    if (payload.role === "ADMINISTRADOR") {
      throw new Error("Tu perfil no puede asignar administradores totales.");
    }
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
  const redirectTo = formData.get("redirectTo");
  if (typeof redirectTo === "string" && redirectTo) {
    redirect(redirectTo);
  }
}

export async function resetUserPasswordAction(formData: FormData) {
  const currentUser = await requireRole(ADMIN_ROLES);

  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    newPassword: formData.get("newPassword")
  });

  if (!parsed.success) {
    throw new Error("Contraseña inválida.");
  }

  const payload = parsed.data;
  const targetUser = await db.user.findUnique({
    where: { id: payload.userId },
    select: { role: true }
  });

  if (!targetUser) {
    throw new Error("Usuario no encontrado.");
  }

  if (!isFullAdminRole(currentUser.role) && isFullAdminRole(targetUser.role)) {
    throw new Error("Tu perfil no puede cambiar la clave de administradores totales.");
  }

  const passwordHash = await bcrypt.hash(payload.newPassword, 10);

  await db.user.update({
    where: { id: payload.userId },
    data: { passwordHash }
  });

  revalidatePath("/administracion");
  const redirectTo = formData.get("redirectTo");
  redirect(typeof redirectTo === "string" && redirectTo ? redirectTo : "/administracion");
}

export async function deleteUserAction(formData: FormData) {
  const currentUser = await requireRole(FULL_ADMIN_ROLES);

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
  const redirectTo = formData.get("redirectTo");
  if (typeof redirectTo === "string" && redirectTo) {
    redirect(redirectTo);
  }
}

export async function createCampAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = createCampSchema.safeParse({
    name: formData.get("name"),
    location: String(formData.get("location") ?? ""),
    latitude: formData.get("latitude") === "" ? undefined : formData.get("latitude"),
    longitude: formData.get("longitude") === "" ? undefined : formData.get("longitude"),
    capacityPeople: formData.get("capacityPeople")
  });

  if (!parsed.success) {
    throw new Error("Datos inválidos para crear campamento.");
  }

  const payload = parsed.data;
  const inferredCoordinates =
    payload.latitude == null && payload.longitude == null && payload.location
      ? await geocodeLocation(payload.location)
      : null;
  await db.camp.create({
    data: {
      name: payload.name,
      location: payload.location || null,
      latitude: payload.latitude ?? inferredCoordinates?.latitude ?? null,
      longitude: payload.longitude ?? inferredCoordinates?.longitude ?? null,
      capacityPeople: payload.capacityPeople,
      isActive: true
    }
  });

  revalidatePath("/administracion");
  revalidatePath("/dashboard");
  revalidatePath("/carga-diaria");
}

export async function createProjectAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    code: String(formData.get("code") ?? ""),
    location: String(formData.get("location") ?? "")
  });

  if (!parsed.success) {
    throw new Error("Datos inválidos para crear proyecto.");
  }

  const payload = parsed.data;

  if (payload.code) {
    const existing = await db.project.findUnique({ where: { code: payload.code } });
    if (existing) {
      throw new Error("Ya existe un proyecto con ese código.");
    }
  }

  await db.project.create({
    data: {
      name: payload.name,
      code: payload.code || null,
      location: payload.location || null,
      isActive: true
    }
  });

  revalidatePath("/administracion");
  revalidatePath("/vehiculos");
}

export async function updateCampAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = updateCampSchema.safeParse({
    campId: formData.get("campId"),
    name: formData.get("name"),
    location: String(formData.get("location") ?? ""),
    latitude: formData.get("latitude") === "" ? undefined : formData.get("latitude"),
    longitude: formData.get("longitude") === "" ? undefined : formData.get("longitude"),
    capacityPeople: formData.get("capacityPeople"),
    isActive: formData.get("isActive")
  });

  if (!parsed.success) {
    throw new Error("Datos inválidos para actualizar campamento.");
  }

  const payload = parsed.data;
  const inferredCoordinates =
    payload.latitude == null && payload.longitude == null && payload.location
      ? await geocodeLocation(payload.location)
      : null;

  await db.camp.update({
    where: { id: payload.campId },
    data: {
      name: payload.name,
      location: payload.location || null,
      latitude: payload.latitude ?? inferredCoordinates?.latitude ?? null,
      longitude: payload.longitude ?? inferredCoordinates?.longitude ?? null,
      capacityPeople: payload.capacityPeople,
      isActive: payload.isActive === "on"
    }
  });

  revalidatePath("/administracion");
  revalidatePath("/dashboard");
  revalidatePath("/carga-diaria");
  redirect("/administracion?campStatus=updated");
}

export async function updateCampShiftAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);

  const parsed = updateCampShiftSchema.safeParse({
    campId: formData.get("campId"),
    supervisorId: formData.get("supervisorId"),
    shiftPattern: formData.get("shiftPattern"),
    shiftStartDate: formData.get("shiftStartDate")
  });

  if (!parsed.success) {
    throw new Error("Datos inválidos para iniciar nuevo turno.");
  }

  const payload = parsed.data;
  const shiftRules = {
    "14x14": { work: 14, off: 14 },
    "10x10": { work: 10, off: 10 },
    "7x7": { work: 7, off: 7 },
    "4x3": { work: 4, off: 3 }
  } as const;

  const supervisor = await db.user.findFirst({
    where: {
      id: payload.supervisorId,
      isActive: true,
      role: { in: ["SUPERVISOR", "OPERADOR"] },
      campId: payload.campId
    },
    select: { id: true, name: true }
  });

  if (!supervisor) {
    throw new Error("El supervisor seleccionado no pertenece a este campamento.");
  }

  const shiftRule = shiftRules[payload.shiftPattern];
  const shiftStartDate = new Date(`${payload.shiftStartDate}T00:00:00.000Z`);

  await db.$transaction([
    db.user.update({
      where: { id: supervisor.id },
      data: {
        shiftPattern: payload.shiftPattern,
        shiftWorkDays: shiftRule.work,
        shiftOffDays: shiftRule.off,
        shiftStartDate
      }
    }),
    db.camp.update({
      where: { id: payload.campId },
      data: {
        currentShiftSupervisorId: supervisor.id,
        currentShiftSupervisorName: supervisor.name,
        currentShiftPattern: payload.shiftPattern,
        currentShiftWorkDays: shiftRule.work,
        currentShiftOffDays: shiftRule.off,
        currentShiftStartDate: shiftStartDate
      }
    })
  ]);

  revalidatePath("/administracion");
  revalidatePath(`/administracion/campamentos/${payload.campId}`);
  revalidatePath("/dashboard");
  redirect(`/administracion/campamentos/${payload.campId}?shiftStatus=updated`);
}

export async function deleteCampAction(formData: FormData) {
  await requireRole(FULL_ADMIN_ROLES);

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
  await requireRole(FULL_ADMIN_ROLES);

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
