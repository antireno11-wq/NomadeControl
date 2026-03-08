"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSupervisorRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ADMIN_DAILY_TASKS, OPERATIONAL_DAILY_TASKS, taskKeyFromLabel } from "@/lib/daily-task-checklists";
import { normalizeDateOnly } from "@/lib/report-utils";

const schema = z.object({
  date: z.string().min(1),
  campId: z.string().min(1),
  notes: z.string().optional()
});

export type DailyTasksFormState = {
  error: string;
  success: string;
};

export async function saveDailyTasksAction(
  _: DailyTasksFormState,
  formData: FormData
): Promise<DailyTasksFormState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    date: formData.get("date"),
    campId: formData.get("campId"),
    notes: String(formData.get("notes") ?? "")
  });

  if (!parsed.success) {
    return { error: "Fecha o campamento inválido.", success: "" };
  }

  const payload = parsed.data;
  if (isSupervisorRole(user.role)) {
    if (!user.campId) {
      return { error: "Tu usuario supervisor no tiene campamento asignado.", success: "" };
    }
    if (user.campId !== payload.campId) {
      return { error: "Solo puedes registrar tareas de tu campamento.", success: "" };
    }
  }

  const adminChecks = Object.fromEntries(
    ADMIN_DAILY_TASKS.map((label) => [taskKeyFromLabel(label), formData.get(taskKeyFromLabel(label)) === "on"])
  );
  const operationalChecks = Object.fromEntries(
    OPERATIONAL_DAILY_TASKS.map((label) => [taskKeyFromLabel(label), formData.get(taskKeyFromLabel(label)) === "on"])
  );

  await db.dailyTaskControl.upsert({
    where: {
      campId_date: {
        campId: payload.campId,
        date: normalizeDateOnly(payload.date)
      }
    },
    update: {
      administrativeChecks: adminChecks,
      operationalChecks,
      notes: payload.notes || null,
      createdById: user.id
    },
    create: {
      campId: payload.campId,
      date: normalizeDateOnly(payload.date),
      administrativeChecks: adminChecks,
      operationalChecks,
      notes: payload.notes || null,
      createdById: user.id
    }
  });

  revalidatePath("/control-tareas-diarias");
  return { error: "", success: "Control de tareas guardado." };
}
