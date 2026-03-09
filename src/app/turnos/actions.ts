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

export type StaffFormState = { error: string; success: string };

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
