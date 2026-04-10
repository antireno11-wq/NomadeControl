"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, isSupervisorRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { normalizeDateOnly } from "@/lib/report-utils";

const patternToDays: Record<string, { work: number; off: number }> = {
  "14x14": { work: 14, off: 14 },
  "10x10": { work: 10, off: 10 },
  "7x7": { work: 7, off: 7 },
  "4x3": { work: 4, off: 3 }
};

const workerSchema = z.object({
  workerId: z.string().optional(),
  campId: z.string().min(1),
  fullName: z.string().trim().min(2),
  role: z.string().trim().optional(),
  employerCompany: z.string().trim().optional(),
  nationalId: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  personalEmail: z.union([z.literal(""), z.string().email()]).optional(),
  shiftPattern: z.enum(["14x14", "10x10", "7x7", "4x3"]),
  shiftStartDate: z.string().min(1),
  contractEndDate: z.string().optional(),
  altitudeExamDueDate: z.string().optional(),
  occupationalExamDueDate: z.string().optional(),
  inductionDueDate: z.string().optional(),
  accreditationDueDate: z.string().optional(),
  driversLicenseDueDate: z.string().optional(),
  notes: z.string().optional(),
  isActive: z.union([z.literal("on"), z.literal("true"), z.literal("")]).optional(),
  successRedirectTo: z.string().min(1),
  errorRedirectTo: z.string().min(1)
});

function normalizeOptionalDate(value?: string) {
  if (!value) return null;
  return normalizeDateOnly(value);
}

async function ensureWorkerAccess(campId: string) {
  const user = await requireRole(OPERATION_ROLES);

  if (isSupervisorRole(user.role)) {
    if (!user.campId) {
      return { user, error: "no-camp" as const };
    }

    if (user.campId !== campId) {
      return { user, error: "forbidden" as const };
    }
  }

  return { user, error: null };
}

export async function createWorkerAction(formData: FormData) {
  const adminUser = await requireRole(ADMIN_ROLES);
  const parsed = workerSchema.safeParse({
    workerId: formData.get("workerId") ?? undefined,
    campId: formData.get("campId"),
    fullName: formData.get("fullName"),
    role: String(formData.get("role") ?? ""),
    employerCompany: String(formData.get("employerCompany") ?? ""),
    nationalId: String(formData.get("nationalId") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    personalEmail: String(formData.get("personalEmail") ?? ""),
    shiftPattern: formData.get("shiftPattern"),
    shiftStartDate: formData.get("shiftStartDate"),
    contractEndDate: String(formData.get("contractEndDate") ?? ""),
    altitudeExamDueDate: String(formData.get("altitudeExamDueDate") ?? ""),
    occupationalExamDueDate: String(formData.get("occupationalExamDueDate") ?? ""),
    inductionDueDate: String(formData.get("inductionDueDate") ?? ""),
    accreditationDueDate: String(formData.get("accreditationDueDate") ?? ""),
    driversLicenseDueDate: String(formData.get("driversLicenseDueDate") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    isActive: String(formData.get("isActive") ?? ""),
    successRedirectTo: formData.get("successRedirectTo"),
    errorRedirectTo: formData.get("errorRedirectTo")
  });

  if (!parsed.success) {
    redirect(`${String(formData.get("errorRedirectTo") ?? "/trabajadores/nuevo")}?status=invalid`);
  }

  const payload = parsed.data;

  const rule = patternToDays[payload.shiftPattern];

  const worker = await db.staffMember.create({
    data: {
      campId: payload.campId,
      createdById: adminUser.id,
      fullName: payload.fullName,
      role: payload.role || null,
      employerCompany: payload.employerCompany || null,
      nationalId: payload.nationalId || null,
      phone: payload.phone || null,
      personalEmail: payload.personalEmail || null,
      shiftPattern: payload.shiftPattern,
      shiftWorkDays: rule.work,
      shiftOffDays: rule.off,
      shiftStartDate: normalizeDateOnly(payload.shiftStartDate),
      contractEndDate: normalizeOptionalDate(payload.contractEndDate),
      altitudeExamDueDate: normalizeOptionalDate(payload.altitudeExamDueDate),
      occupationalExamDueDate: normalizeOptionalDate(payload.occupationalExamDueDate),
      inductionDueDate: normalizeOptionalDate(payload.inductionDueDate),
      accreditationDueDate: normalizeOptionalDate(payload.accreditationDueDate),
      driversLicenseDueDate: normalizeOptionalDate(payload.driversLicenseDueDate),
      notes: payload.notes || null,
      isActive: payload.isActive === "on" || payload.isActive === "true"
    }
  });

  revalidatePath("/trabajadores");
  await logAuditEvent({
    actorUserId: adminUser.id,
    actorName: adminUser.name,
    actorEmail: adminUser.email,
    action: "CREATE_WORKER",
    entityType: "staffMember",
    entityId: worker.id,
    summary: `Creó trabajador ${worker.fullName}`,
    metadata: {
      campId: worker.campId,
      role: worker.role
    }
  });
  redirect(payload.successRedirectTo);
}

export async function updateWorkerAction(formData: FormData) {
  const parsed = workerSchema.safeParse({
    workerId: formData.get("workerId"),
    campId: formData.get("campId"),
    fullName: formData.get("fullName"),
    role: String(formData.get("role") ?? ""),
    employerCompany: String(formData.get("employerCompany") ?? ""),
    nationalId: String(formData.get("nationalId") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    personalEmail: String(formData.get("personalEmail") ?? ""),
    shiftPattern: formData.get("shiftPattern"),
    shiftStartDate: formData.get("shiftStartDate"),
    contractEndDate: String(formData.get("contractEndDate") ?? ""),
    altitudeExamDueDate: String(formData.get("altitudeExamDueDate") ?? ""),
    occupationalExamDueDate: String(formData.get("occupationalExamDueDate") ?? ""),
    inductionDueDate: String(formData.get("inductionDueDate") ?? ""),
    accreditationDueDate: String(formData.get("accreditationDueDate") ?? ""),
    driversLicenseDueDate: String(formData.get("driversLicenseDueDate") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    isActive: String(formData.get("isActive") ?? ""),
    successRedirectTo: formData.get("successRedirectTo"),
    errorRedirectTo: formData.get("errorRedirectTo")
  });

  if (!parsed.success || !parsed.data.workerId) {
    redirect(`${String(formData.get("errorRedirectTo") ?? "/trabajadores")}?status=invalid`);
  }

  const payload = parsed.data;
  const { user, error } = await ensureWorkerAccess(payload.campId);

  if (error === "no-camp") {
    redirect(`${payload.errorRedirectTo}?status=no-camp`);
  }

  if (error === "forbidden") {
    redirect(`${payload.errorRedirectTo}?status=forbidden`);
  }

  const worker = await db.staffMember.findUnique({ where: { id: payload.workerId } });
  if (!worker) {
    redirect(`${payload.errorRedirectTo}?status=not-found`);
  }

  if (isSupervisorRole(user.role) && worker.campId !== user.campId) {
    redirect(`${payload.errorRedirectTo}?status=forbidden`);
  }

  const rule = patternToDays[payload.shiftPattern];

  const updatedWorker = await db.staffMember.update({
    where: { id: worker.id },
    data: {
      campId: payload.campId,
      fullName: payload.fullName,
      role: payload.role || null,
      employerCompany: payload.employerCompany || null,
      nationalId: payload.nationalId || null,
      phone: payload.phone || null,
      personalEmail: payload.personalEmail || null,
      shiftPattern: payload.shiftPattern,
      shiftWorkDays: rule.work,
      shiftOffDays: rule.off,
      shiftStartDate: normalizeDateOnly(payload.shiftStartDate),
      contractEndDate: normalizeOptionalDate(payload.contractEndDate),
      altitudeExamDueDate: normalizeOptionalDate(payload.altitudeExamDueDate),
      occupationalExamDueDate: normalizeOptionalDate(payload.occupationalExamDueDate),
      inductionDueDate: normalizeOptionalDate(payload.inductionDueDate),
      accreditationDueDate: normalizeOptionalDate(payload.accreditationDueDate),
      driversLicenseDueDate: normalizeOptionalDate(payload.driversLicenseDueDate),
      notes: payload.notes || null,
      isActive: payload.isActive === "on" || payload.isActive === "true"
    }
  });

  revalidatePath("/trabajadores");
  revalidatePath(`/trabajadores/${worker.id}`);
  await logAuditEvent({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "UPDATE_WORKER",
    entityType: "staffMember",
    entityId: updatedWorker.id,
    summary: `Actualizó trabajador ${updatedWorker.fullName}`,
    metadata: {
      campId: updatedWorker.campId,
      role: updatedWorker.role
    }
  });
  redirect(payload.successRedirectTo);
}
