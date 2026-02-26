"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeDateOnly } from "@/lib/report-utils";

const reportSchema = z.object({
  date: z.string().min(1),
  campId: z.string().min(1),
  peopleCount: z.coerce.number().int().min(0),
  breakfastCount: z.coerce.number().int().min(0),
  lunchCount: z.coerce.number().int().min(0),
  dinnerCount: z.coerce.number().int().min(0),
  waterLiters: z.coerce.number().int().min(0),
  fuelLiters: z.coerce.number().int().min(0),
  notes: z.string().optional()
});

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function saveReportAction(_: { error?: string; success?: string } | undefined, formData: FormData) {
  const user = await requireUser();

  const parsed = reportSchema.safeParse({
    date: formData.get("date"),
    campId: formData.get("campId"),
    peopleCount: formData.get("peopleCount"),
    breakfastCount: formData.get("breakfastCount"),
    lunchCount: formData.get("lunchCount"),
    dinnerCount: formData.get("dinnerCount"),
    waterLiters: formData.get("waterLiters"),
    fuelLiters: formData.get("fuelLiters"),
    notes: String(formData.get("notes") ?? "")
  });

  if (!parsed.success) {
    return { error: "Verifica los campos numéricos y la fecha." };
  }

  const payload = parsed.data;
  const date = normalizeDateOnly(payload.date);

  await db.dailyReport.upsert({
    where: {
      campId_date: {
        campId: payload.campId,
        date
      }
    },
    update: {
      peopleCount: payload.peopleCount,
      breakfastCount: payload.breakfastCount,
      lunchCount: payload.lunchCount,
      dinnerCount: payload.dinnerCount,
      waterLiters: payload.waterLiters,
      fuelLiters: payload.fuelLiters,
      notes: payload.notes || null,
      createdById: user.id
    },
    create: {
      campId: payload.campId,
      date,
      peopleCount: payload.peopleCount,
      breakfastCount: payload.breakfastCount,
      lunchCount: payload.lunchCount,
      dinnerCount: payload.dinnerCount,
      waterLiters: payload.waterLiters,
      fuelLiters: payload.fuelLiters,
      notes: payload.notes || null,
      createdById: user.id
    }
  });

  revalidatePath("/dashboard");
  return { success: "Reporte guardado correctamente." };
}
