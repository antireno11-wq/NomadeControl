"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSupervisorRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeDateOnly } from "@/lib/report-utils";

const patternToDays: Record<string, { work: number; off: number }> = {
  "14x14": { work: 14, off: 14 },
  "10x10": { work: 10, off: 10 },
  "7x7": { work: 7, off: 7 },
  "4x3": { work: 4, off: 3 }
};

const schema = z.object({
  campId: z.string().min(1),
  fullName: z.string().trim().min(2),
  role: z.string().trim().optional(),
  shiftPattern: z.enum(["14x14", "10x10", "7x7", "4x3"]),
  shiftStartDate: z.string().min(1),
  notes: z.string().optional()
});

const toggleSchema = z.object({
  staffMemberId: z.string().min(1),
  date: z.string().min(1),
  currentStatus: z.enum(["TRABAJA", "AUSENTE"])
});

export type StaffFormState = { error: string; success: string };

export async function saveStaffMemberAction(_: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const user = await requireRole(OPERATION_ROLES);

  const parsed = schema.safeParse({
    campId: formData.get("campId"),
    fullName: formData.get("fullName"),
    role: String(formData.get("role") ?? ""),
    shiftPattern: formData.get("shiftPattern"),
    shiftStartDate: formData.get("shiftStartDate"),
    notes: String(formData.get("notes") ?? "")
  });

  if (!parsed.success) {
    return { error: "Verifica los datos del turno.", success: "" };
  }

  const payload = parsed.data;

  if (isSupervisorRole(user.role)) {
    if (!user.campId) {
      return { error: "Tu usuario supervisor no tiene campamento asignado.", success: "" };
    }
    if (payload.campId !== user.campId) {
      return { error: "Solo puedes cargar turnos de tu campamento.", success: "" };
    }
  }

  const rule = patternToDays[payload.shiftPattern];

  await db.staffMember.create({
    data: {
      campId: payload.campId,
      createdById: user.id,
      fullName: payload.fullName,
      role: payload.role || null,
      shiftPattern: payload.shiftPattern,
      shiftWorkDays: rule.work,
      shiftOffDays: rule.off,
      shiftStartDate: normalizeDateOnly(payload.shiftStartDate),
      notes: payload.notes || null,
      isActive: true
    }
  });

  revalidatePath("/turnos");
  return { error: "", success: "Personal agregado al control de turnos." };
}

export async function toggleShiftDayAction(formData: FormData) {
  const user = await requireRole(OPERATION_ROLES);

  const parsed = toggleSchema.safeParse({
    staffMemberId: formData.get("staffMemberId"),
    date: formData.get("date"),
    currentStatus: formData.get("currentStatus")
  });

  if (!parsed.success) return;

  const payload = parsed.data;
  const date = normalizeDateOnly(payload.date);

  const member = await db.staffMember.findUnique({
    where: { id: payload.staffMemberId }
  });

  if (!member || !member.isActive) return;

  if (isSupervisorRole(user.role)) {
    if (!user.campId || member.campId !== user.campId) return;
  }

  const nextStatus = payload.currentStatus === "TRABAJA" ? "AUSENTE" : "TRABAJA";

  await db.staffShiftDay.upsert({
    where: {
      staffMemberId_date: {
        staffMemberId: member.id,
        date
      }
    },
    update: { status: nextStatus },
    create: {
      staffMemberId: member.id,
      date,
      status: nextStatus
    }
  });

  revalidatePath("/turnos");
}
