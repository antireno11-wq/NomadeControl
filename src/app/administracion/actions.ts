"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_ROLES, ALL_MODULES, FULL_ADMIN_ROLES, MANAGED_USER_ROLE_VALUES, isAdminRole, isFullAdminRole, requireRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { sendWelcomeEmail } from "@/lib/mailer";
import { geocodeLocation } from "@/lib/weather";
import { sembrarMatriz } from "@/lib/requisitos-db";

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
  potableWaterTankCapacityM3: z.coerce.number().min(0).optional(),
  blackWaterTankCapacityM3: z.coerce.number().min(0).optional(),
  greyWaterTankCapacityM3: z.coerce.number().min(0).optional(),
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
  potableWaterTankCapacityM3: z.coerce.number().min(0).optional(),
  blackWaterTankCapacityM3: z.coerce.number().min(0).optional(),
  greyWaterTankCapacityM3: z.coerce.number().min(0).optional(),
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

    // Módulos custom (vacío = usar defaults del rol)
    const validModuleKeys = ALL_MODULES.map((m) => m.key);
    const selectedModules = isAdminRole(payload.role)
      ? []
      : validModuleKeys.filter((key) => formData.get(`mod_${key}`) === "on");

    const createdUser = await db.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        role: payload.role,
        campId,
        isActive: true,
        passwordHash,
        ...(selectedModules.length > 0 ? { modulePermissions: selectedModules } : {}),
      }
    });

    await logAuditEvent({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorEmail: currentUser.email,
      action: "CREATE_USER",
      entityType: "user",
      entityId: createdUser.id,
      summary: `Creó usuario ${createdUser.email}`,
      metadata: { role: createdUser.role, campId: createdUser.campId }
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

  const updatedUser = await db.user.update({
    where: { id: payload.userId },
    data: {
      name: payload.name,
      role: payload.role,
      isActive: payload.isActive === "on",
      campId: normalizedCampIdForRole(payload.role, payload.campId)
    }
  });

  await logAuditEvent({
    actorUserId: currentUser.id,
    actorName: currentUser.name,
    actorEmail: currentUser.email,
    action: "UPDATE_USER",
    entityType: "user",
    entityId: updatedUser.id,
    summary: `Actualizó usuario ${updatedUser.email}`,
    metadata: { role: updatedUser.role, campId: updatedUser.campId, isActive: updatedUser.isActive }
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
  const currentUser = await requireRole(ADMIN_ROLES);

  const parsed = createCampSchema.safeParse({
    name: formData.get("name"),
    location: String(formData.get("location") ?? ""),
    latitude: formData.get("latitude") === "" ? undefined : formData.get("latitude"),
    longitude: formData.get("longitude") === "" ? undefined : formData.get("longitude"),
    potableWaterTankCapacityM3:
      formData.get("potableWaterTankCapacityM3") === "" ? undefined : formData.get("potableWaterTankCapacityM3"),
    blackWaterTankCapacityM3:
      formData.get("blackWaterTankCapacityM3") === "" ? undefined : formData.get("blackWaterTankCapacityM3"),
    greyWaterTankCapacityM3:
      formData.get("greyWaterTankCapacityM3") === "" ? undefined : formData.get("greyWaterTankCapacityM3"),
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
  const createdCamp = await db.camp.create({
    data: {
      name: payload.name,
      location: payload.location || null,
      latitude: payload.latitude ?? inferredCoordinates?.latitude ?? null,
      longitude: payload.longitude ?? inferredCoordinates?.longitude ?? null,
      potableWaterTankCapacityM3: payload.potableWaterTankCapacityM3 ?? null,
      blackWaterTankCapacityM3: payload.blackWaterTankCapacityM3 ?? null,
      greyWaterTankCapacityM3: payload.greyWaterTankCapacityM3 ?? null,
      capacityPeople: payload.capacityPeople,
      isActive: true
    }
  });

  await logAuditEvent({
    actorUserId: currentUser.id,
    actorName: currentUser.name,
    actorEmail: currentUser.email,
    action: "CREATE_CAMP",
    entityType: "camp",
    entityId: createdCamp.id,
    summary: `Creó campamento ${createdCamp.name}`
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

export async function cerrarProyectoAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);
  const projectId = formData.get("projectId") as string;
  if (!projectId) redirect("/administracion?seccion=proyectos&projectStatus=invalid");

  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) redirect("/administracion?seccion=proyectos&projectStatus=not-found");

  await db.project.update({
    where: { id: projectId },
    data: { isActive: false },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "PROJECT_CLOSE", entityType: "project", entityId: projectId,
    summary: `Finalizó proyecto «${project.name}»`,
  });

  revalidatePath("/administracion");
  revalidatePath("/vehiculos");
  redirect("/administracion?seccion=proyectos&projectStatus=closed");
}

export async function reabrirProyectoAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);
  const projectId = formData.get("projectId") as string;
  if (!projectId) redirect("/administracion?seccion=proyectos&projectStatus=invalid");

  await db.project.update({
    where: { id: projectId },
    data: { isActive: true },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "PROJECT_REOPEN", entityType: "project", entityId: projectId,
    summary: `Reabrió proyecto`,
  });

  revalidatePath("/administracion");
  revalidatePath("/vehiculos");
  redirect("/administracion?seccion=proyectos");
}

export async function updateCampAction(formData: FormData) {
  const currentUser = await requireRole(ADMIN_ROLES);

  const parsed = updateCampSchema.safeParse({
    campId: formData.get("campId"),
    name: formData.get("name"),
    location: String(formData.get("location") ?? ""),
    latitude: formData.get("latitude") === "" ? undefined : formData.get("latitude"),
    longitude: formData.get("longitude") === "" ? undefined : formData.get("longitude"),
    potableWaterTankCapacityM3:
      formData.get("potableWaterTankCapacityM3") === "" ? undefined : formData.get("potableWaterTankCapacityM3"),
    blackWaterTankCapacityM3:
      formData.get("blackWaterTankCapacityM3") === "" ? undefined : formData.get("blackWaterTankCapacityM3"),
    greyWaterTankCapacityM3:
      formData.get("greyWaterTankCapacityM3") === "" ? undefined : formData.get("greyWaterTankCapacityM3"),
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

  const updatedCamp = await db.camp.update({
    where: { id: payload.campId },
    data: {
      name: payload.name,
      location: payload.location || null,
      latitude: payload.latitude ?? inferredCoordinates?.latitude ?? null,
      longitude: payload.longitude ?? inferredCoordinates?.longitude ?? null,
      potableWaterTankCapacityM3: payload.potableWaterTankCapacityM3 ?? null,
      blackWaterTankCapacityM3: payload.blackWaterTankCapacityM3 ?? null,
      greyWaterTankCapacityM3: payload.greyWaterTankCapacityM3 ?? null,
      capacityPeople: payload.capacityPeople,
      isActive: payload.isActive === "on"
    }
  });

  await logAuditEvent({
    actorUserId: currentUser.id,
    actorName: currentUser.name,
    actorEmail: currentUser.email,
    action: "UPDATE_CAMP",
    entityType: "camp",
    entityId: updatedCamp.id,
    summary: `Actualizó campamento ${updatedCamp.name}`,
    metadata: { isActive: updatedCamp.isActive, capacityPeople: updatedCamp.capacityPeople }
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

export async function cerrarCampamentoAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);
  const campId = formData.get("campId") as string;
  if (!campId) redirect("/administracion?campStatus=invalid");

  // Parsear fecha de cierre (opcional, default = hoy).
  // Formato esperado del <input type="date">: YYYY-MM-DD.
  const closedAtRaw = String(formData.get("closedAt") ?? "").trim();
  let closedAt: Date = new Date();
  if (closedAtRaw && /^\d{4}-\d{2}-\d{2}$/.test(closedAtRaw)) {
    const [y, m, d] = closedAtRaw.split("-").map(Number);
    // Guardamos al mediodía UTC para evitar saltos de día por TZ
    const parsed = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    if (!Number.isNaN(parsed.getTime())) closedAt = parsed;
  }

  // Validar que no sea futura (más de 1 día adelante)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  if (closedAt.getTime() >= tomorrow.getTime()) {
    redirect(`/operaciones/campamento/${campId}/resumen?status=invalid-date`);
  }

  const camp = await db.camp.findUnique({
    where: { id: campId },
    select: { id: true, name: true, isActive: true },
  });
  if (!camp) redirect("/administracion?campStatus=not-found");

  // Liberar trabajadores activos (quedan sin campamento, siguen activos)
  await db.staffMember.updateMany({
    where: { campId, isActive: true },
    data: { campId: null },
  });

  // Cerrar el campamento con la fecha indicada
  await db.camp.update({
    where: { id: campId },
    data: { isActive: false, closedAt },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "CAMP_CLOSE", entityType: "camp", entityId: campId,
    summary: `Cerró campamento «${camp.name}» con fecha ${closedAt.toISOString().slice(0, 10)}`,
  });

  revalidatePath("/administracion");
  revalidatePath("/dashboard");
  revalidatePath("/operaciones");
  redirect(`/operaciones/campamento/${campId}/resumen?status=closed`);
}

export async function reabrirCampamentoAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);
  const campId = formData.get("campId") as string;
  if (!campId) redirect("/administracion?campStatus=invalid");

  await db.camp.update({
    where: { id: campId },
    data: { isActive: true, closedAt: null },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "CAMP_REOPEN", entityType: "camp", entityId: campId,
    summary: `Reabrió campamento`,
  });

  revalidatePath("/administracion");
  revalidatePath("/operaciones");
  redirect(`/administracion/campamentos/${campId}`);
}

export async function updateUserModulesAction(formData: FormData) {
  const currentUser = await requireRole(ADMIN_ROLES);

  const userId = formData.get("userId");
  if (typeof userId !== "string" || !userId) {
    throw new Error("Usuario inválido.");
  }

  const targetUser = await db.user.findUnique({
    where: { id: userId },
    select: { role: true }
  });

  if (!targetUser) {
    throw new Error("Usuario no encontrado.");
  }

  // Full admins don't use module permissions — just skip silently
  if (isAdminRole(targetUser.role)) {
    revalidatePath(`/administracion/usuarios/${userId}`);
    redirect(`/administracion/usuarios/${userId}?status=saved`);
  }

  const validKeys = ALL_MODULES.map((m) => m.key);
  const selectedModules = validKeys.filter((key) => formData.get(`mod_${key}`) === "on");

  await db.user.update({
    where: { id: userId },
    data: { modulePermissions: selectedModules }
  });

  await logAuditEvent({
    actorUserId: currentUser.id,
    actorName: currentUser.name,
    actorEmail: currentUser.email,
    action: "UPDATE_USER",
    entityType: "user",
    entityId: userId,
    summary: `Actualizó permisos de módulos del usuario`,
    metadata: { modules: selectedModules }
  });

  revalidatePath(`/administracion/usuarios/${userId}`);
  revalidatePath("/administracion");
  redirect(`/administracion/usuarios/${userId}?status=saved`);
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

// ─── Catálogo de tipos de documento ──────────────────────────────────

const tipoDocumentoSchema = z.object({
  nombre: z.string().trim().min(2),
  categoria: z.enum(["identidad", "previsional", "salud_ocupacional", "formacion", "laboral", "seguros"]),
  etiquetaCorta: z.string().trim().optional(),
  vigenciaDias: z.string().optional(),
  noVence: z.string().optional(),
  mostrarEnMatriz: z.string().optional(),
  orden: z.string().optional(),
});

/** Genera un código estable a partir del nombre: "Curso de altura" → "curso_de_altura". */
function codigoDesdeNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

export async function crearTipoDocumentoAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);

  const parsed = tipoDocumentoSchema.safeParse({
    nombre: formData.get("nombre"),
    categoria: formData.get("categoria"),
    etiquetaCorta: String(formData.get("etiquetaCorta") ?? ""),
    vigenciaDias: String(formData.get("vigenciaDias") ?? ""),
    noVence: String(formData.get("noVence") ?? ""),
    mostrarEnMatriz: String(formData.get("mostrarEnMatriz") ?? ""),
    orden: String(formData.get("orden") ?? ""),
  });

  if (!parsed.success) {
    redirect("/administracion?seccion=documentos&tipoStatus=invalido");
  }

  const d = parsed.data;
  let codigo = codigoDesdeNombre(d.nombre);
  if (!codigo) redirect("/administracion?seccion=documentos&tipoStatus=invalido");

  // Si el código ya existe, le agregamos un sufijo en vez de fallar
  const existente = await db.tipoDocumento.findUnique({ where: { codigo } });
  if (existente) codigo = `${codigo}_${Date.now().toString(36).slice(-4)}`;

  const vigencia = d.vigenciaDias?.trim() ? Number(d.vigenciaDias) : null;

  await db.tipoDocumento.create({
    data: {
      codigo,
      nombre: d.nombre,
      categoria: d.categoria,
      etiquetaCorta: d.etiquetaCorta?.trim() || d.nombre.slice(0, 14),
      vigenciaDias: vigencia && vigencia > 0 ? vigencia : null,
      noVence: d.noVence === "on",
      mostrarEnMatriz: d.mostrarEnMatriz === "on",
      requiereArchivo: true,
      orden: d.orden?.trim() ? Number(d.orden) : 500,
      activo: true,
    },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "TIPO_DOCUMENTO_CREATE",
    entityType: "tipoDocumento",
    summary: `Creó el tipo de documento «${d.nombre}»`,
  }).catch(() => {});

  revalidatePath("/administracion");
  revalidatePath("/trabajadores/control-documental");
  redirect("/administracion?seccion=documentos&tipoStatus=creado");
}

export async function actualizarTipoDocumentoAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);
  const id = String(formData.get("tipoId") ?? "");
  if (!id) redirect("/administracion?seccion=documentos&tipoStatus=invalido");

  const nombre = String(formData.get("nombre") ?? "").trim();
  const etiquetaCorta = String(formData.get("etiquetaCorta") ?? "").trim();
  const vigenciaRaw = String(formData.get("vigenciaDias") ?? "").trim();
  const vigencia = vigenciaRaw ? Number(vigenciaRaw) : null;

  // Un tipo que no vence no puede conservar una vigencia por defecto: si la
  // deja, los documentos nuevos siguen naciendo con un vencimiento calculado.
  const noVence = formData.get("noVence") === "on";

  await db.tipoDocumento.update({
    where: { id },
    data: {
      ...(nombre.length >= 2 ? { nombre } : {}),
      etiquetaCorta: etiquetaCorta || null,
      vigenciaDias: noVence ? null : (vigencia && vigencia > 0 ? vigencia : null),
      noVence,
      // Área y plazo de gestión. El plazo va en días hábiles y es de quién
      // debe conseguir el documento, no de cuánto dura una vez conseguido.
      areaResponsable: String(formData.get("areaResponsable") ?? "").trim() || null,
      plazoDiasHabiles: (() => {
        const v = Number(String(formData.get("plazoDiasHabiles") ?? "").trim());
        return Number.isFinite(v) && v > 0 ? v : null;
      })(),
      mostrarEnMatriz: formData.get("mostrarEnMatriz") === "on",
      activo: formData.get("activo") === "on",
    },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "TIPO_DOCUMENTO_UPDATE",
    entityType: "tipoDocumento",
    entityId: id,
    summary: `Editó el tipo de documento «${nombre}»`,
  }).catch(() => {});

  revalidatePath("/administracion");
  revalidatePath("/trabajadores/control-documental");
  redirect("/administracion?seccion=documentos&tipoStatus=guardado");
}

// ─── Matriz de requisitos por cargo ──────────────────────────────────

/**
 * Crea un mandante (si no existe) con su proyecto y siembra la matriz por
 * defecto. Reemplaza la columna "Aplica a" de la planilla, que había que
 * traducir a mano a un N/A por celda.
 */
export async function crearProyectoAcreditacionAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);

  const mandante = String(formData.get("mandante") ?? "").trim();
  const nombre = String(formData.get("nombre") ?? "").trim();
  const faena = String(formData.get("faena") ?? "").trim();
  const altitudRaw = String(formData.get("altitudMsnm") ?? "").trim();
  const ambito = String(formData.get("ambito") ?? "mandante") === "interno" ? "interno" : "mandante";
  const altitud = altitudRaw ? Number(altitudRaw) : null;

  if (mandante.length < 2 || nombre.length < 2) {
    redirect("/administracion?seccion=requisitos&reqStatus=invalido");
  }

  const m = await db.mandante.upsert({
    where:  { nombre: mandante },
    update: {},
    create: { nombre: mandante },
  });

  const existente = await db.proyecto.findUnique({
    where: { mandanteId_nombre: { mandanteId: m.id, nombre } },
    select: { id: true },
  });
  if (existente) {
    redirect(`/administracion?seccion=requisitos&proyecto=${existente.id}&reqStatus=duplicado`);
  }

  const proyecto = await db.proyecto.create({
    data: {
      mandanteId: m.id,
      nombre,
      ambito,
      faena: faena || null,
      altitudMsnm: altitud != null && Number.isFinite(altitud) && altitud > 0 ? Math.round(altitud) : null,
    },
    select: { id: true },
  });

  const sembrados = await sembrarMatriz(proyecto.id);

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "PROYECTO_ACREDITACION_CREATE",
    entityType: "proyecto",
    entityId: proyecto.id,
    summary: `Creó el proyecto «${nombre}» de ${mandante} con ${sembrados} requisitos`,
  }).catch(() => {});

  revalidatePath("/administracion");
  redirect(`/administracion?seccion=requisitos&proyecto=${proyecto.id}&reqStatus=creado`);
}

export async function crearCargoAction(formData: FormData) {
  await requireRole(ADMIN_ROLES);
  const nombre = String(formData.get("nombre") ?? "").trim();
  const proyectoId = String(formData.get("proyectoId") ?? "");
  if (nombre.length < 2) {
    redirect(`/administracion?seccion=requisitos&proyecto=${proyectoId}&reqStatus=invalido`);
  }

  const existente = await db.cargo.findUnique({ where: { nombre }, select: { id: true } });
  if (!existente) {
    const ultimo = await db.cargo.findFirst({ orderBy: { orden: "desc" }, select: { orden: true } });
    await db.cargo.create({ data: { nombre, orden: (ultimo?.orden ?? 0) + 10 } });
  }

  revalidatePath("/administracion");
  redirect(`/administracion?seccion=requisitos&proyecto=${proyectoId}&reqStatus=cargo`);
}

/**
 * Define, cambia o quita un requisito de una celda de la grilla.
 *
 * `nivel: null` borra la fila: la ausencia de fila ES el "no aplica", así que
 * no se guardan ~400 negativos como hacía la planilla.
 */
export async function setRequisitoAction(input: {
  proyectoId: string;
  cargoId: string;
  tipoId: string;
  nivel: "obligatorio" | "deseable" | null;
  condicion?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole(ADMIN_ROLES);
  } catch {
    return { ok: false, error: "Sin permisos" };
  }

  const { proyectoId, cargoId, tipoId, nivel } = input;
  if (!proyectoId || !cargoId || !tipoId) return { ok: false, error: "Datos incompletos" };

  const clave = { proyectoId_cargoId_tipoId: { proyectoId, cargoId, tipoId } };

  if (nivel === null) {
    await db.requisitoDocumento.deleteMany({ where: { proyectoId, cargoId, tipoId } });
  } else {
    await db.requisitoDocumento.upsert({
      where:  clave,
      update: { nivel, ...(input.condicion !== undefined ? { condicion: input.condicion } : {}) },
      create: { proyectoId, cargoId, tipoId, nivel, condicion: input.condicion ?? null },
    });
  }

  revalidatePath("/administracion");
  revalidatePath("/trabajadores/control-documental");
  return { ok: true };
}

/** Aplica un nivel a todos los cargos de una fila de la grilla, de una vez. */
export async function setRequisitoFilaAction(input: {
  proyectoId: string;
  tipoId: string;
  nivel: "obligatorio" | "deseable" | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole(ADMIN_ROLES);
  } catch {
    return { ok: false, error: "Sin permisos" };
  }

  const { proyectoId, tipoId, nivel } = input;
  if (!proyectoId || !tipoId) return { ok: false, error: "Datos incompletos" };

  if (nivel === null) {
    await db.requisitoDocumento.deleteMany({ where: { proyectoId, tipoId } });
  } else {
    const cargos = await db.cargo.findMany({ where: { activo: true }, select: { id: true } });
    await db.$transaction([
      db.requisitoDocumento.updateMany({ where: { proyectoId, tipoId }, data: { nivel } }),
      db.requisitoDocumento.createMany({
        data: cargos.map(c => ({ proyectoId, cargoId: c.id, tipoId, nivel })),
        skipDuplicates: true,
      }),
    ]);
  }

  revalidatePath("/administracion");
  revalidatePath("/trabajadores/control-documental");
  return { ok: true };
}

/**
 * Cambia la condición de un documento en toda la matriz de un proyecto.
 *
 * La condición es del documento, no de la celda: el anexo de contrato se
 * exige o no según el estado del contrato de esa persona, y eso no depende
 * del cargo. Por eso se aplica a la fila completa.
 */
export async function setCondicionFilaAction(input: {
  proyectoId: string;
  tipoId: string;
  condicion: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole(ADMIN_ROLES);
  } catch {
    return { ok: false, error: "Sin permisos" };
  }

  const { proyectoId, tipoId, condicion } = input;
  if (!proyectoId || !tipoId) return { ok: false, error: "Datos incompletos" };

  const validas = ["contrato_indefinido", "trabajo_previo_mandante", "contrato_vencido"];
  if (condicion !== null && !validas.includes(condicion)) {
    return { ok: false, error: "Condición desconocida" };
  }

  await db.requisitoDocumento.updateMany({
    where: { proyectoId, tipoId },
    data: { condicion },
  });

  revalidatePath("/administracion");
  revalidatePath("/trabajadores/control-documental");
  return { ok: true };
}
