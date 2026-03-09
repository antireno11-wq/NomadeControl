"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSupervisorRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeDateOnly } from "@/lib/report-utils";

const schema = z.object({
  campId: z.string().min(1),
  fullName: z.string().trim().min(2),
  role: z.string().trim().optional(),
  shiftStartDate: z.string().min(1),
  notes: z.string().optional()
});

const toggleSchema = z.object({
  staffMemberId: z.string().min(1),
  date: z.string().min(1)
});

export type StaffFormState = { error: string; success: string };

const ON_DAYS = 14;
const OFF_DAYS = 14;
const CYCLE_DAYS = ON_DAYS + OFF_DAYS;

function daysBetween(dateA: Date, dateB: Date) {
  const a = new Date(Date.UTC(dateA.getUTCFullYear(), dateA.getUTCMonth(), dateA.getUTCDate()));
  const b = new Date(Date.UTC(dateB.getUTCFullYear(), dateB.getUTCMonth(), dateB.getUTCDate()));
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function derivedStatus(date: Date, shiftStartDate: Date) {
  const diff = daysBetween(date, shiftStartDate);
  const mod = ((diff % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
  return mod < ON_DAYS ? "TRABAJA" : "DESCANSO";
}

function nextStatus(current: string) {
  if (current === "TRABAJA") return "DESCANSO";
  if (current === "DESCANSO") return "LICENCIA";
  if (current === "LICENCIA") return "AUTO";
  return "TRABAJA";
}

export async function saveStaffMemberAction(_: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const user = await requireRole(OPERATION_ROLES);

  const parsed = schema.safeParse({
    campId: formData.get("campId"),
    fullName: formData.get("fullName"),
    role: String(formData.get("role") ?? ""),
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

  await db.staffMember.create({
    data: {
      campId: payload.campId,
      createdById: user.id,
      fullName: payload.fullName,
      role: payload.role || null,
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
    date: formData.get("date")
  });

  if (!parsed.success) return;

  const payload = parsed.data;
  const date = normalizeDateOnly(payload.date);

  const member = await db.staffMember.findUnique({
    where: { id: payload.staffMemberId },
    include: { camp: true }
  });

  if (!member || !member.isActive) return;

  if (isSupervisorRole(user.role)) {
    if (!user.campId || member.campId !== user.campId) {
      return;
    }
  }

  const existing = await db.staffShiftDay.findUnique({
    where: {
      staffMemberId_date: {
        staffMemberId: member.id,
        date
      }
    }
  });

  const currentStatus = existing?.status ?? derivedStatus(date, member.shiftStartDate);
  const next = nextStatus(currentStatus);

  if (next === "AUTO") {
    if (existing) {
      await db.staffShiftDay.delete({ where: { id: existing.id } });
    }
  } else if (existing) {
    await db.staffShiftDay.update({ where: { id: existing.id }, data: { status: next } });
  } else {
    await db.staffShiftDay.create({
      data: {
        staffMemberId: member.id,
        date,
        status: next
      }
    });
  }

  revalidatePath("/turnos");
}
