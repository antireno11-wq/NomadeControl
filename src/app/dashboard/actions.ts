"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, isSupervisorRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeDateOnly } from "@/lib/report-utils";

const reportSchema = z.object({
  date: z.string().min(1),
  campId: z.string().min(1),
  peopleCount: z.coerce.number().int().min(0),
  breakfastCount: z.coerce.number().int().min(0),
  lunchCount: z.coerce.number().int().min(0),
  dinnerCount: z.coerce.number().int().min(0),
  snackSimpleCount: z.coerce.number().int().min(0),
  snackReplacementCount: z.coerce.number().int().min(0),
  waterBottleCount: z.coerce.number().int().min(0),
  lodgingCount: z.coerce.number().int().min(0),
  meterReading: z.coerce.number().min(0),
  waterLiters: z.coerce.number().int().min(0),
  fuelLiters: z.coerce.number().int().min(0),
  wasteFillPercent: z.coerce.number().int().min(0).max(100),
  chlorineLevel: z.coerce.number().min(0),
  phLevel: z.coerce.number().min(0),
  notes: z.string().optional()
});

export type ReportFormState = {
  error: string;
  success: string;
};

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function saveReportAction(_: ReportFormState, formData: FormData): Promise<ReportFormState> {
  const user = await requireUser();

  if (!isSupervisorRole(user.role)) {
    return { error: "Solo usuarios SUPERVISOR pueden cargar información diaria.", success: "" };
  }

  const parsed = reportSchema.safeParse({
    date: formData.get("date"),
    campId: formData.get("campId"),
    peopleCount: formData.get("peopleCount"),
    breakfastCount: formData.get("breakfastCount"),
    lunchCount: formData.get("lunchCount"),
    dinnerCount: formData.get("dinnerCount"),
    snackSimpleCount: formData.get("snackSimpleCount"),
    snackReplacementCount: formData.get("snackReplacementCount"),
    waterBottleCount: formData.get("waterBottleCount"),
    lodgingCount: formData.get("lodgingCount"),
    meterReading: formData.get("meterReading"),
    waterLiters: formData.get("waterLiters"),
    fuelLiters: formData.get("fuelLiters"),
    wasteFillPercent: formData.get("wasteFillPercent"),
    chlorineLevel: formData.get("chlorineLevel"),
    phLevel: formData.get("phLevel"),
    notes: String(formData.get("notes") ?? "")
  });

  if (!parsed.success) {
    return { error: "Verifica los campos numéricos y la fecha.", success: "" };
  }

  const payload = parsed.data;
  const date = normalizeDateOnly(payload.date);

  if (isSupervisorRole(user.role)) {
    if (!user.campId) {
      return { error: "Tu usuario supervisor no tiene campamento asignado.", success: "" };
    }
    if (payload.campId !== user.campId) {
      return { error: "Solo puedes cargar información de tu campamento asignado.", success: "" };
    }
  }

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
      snackSimpleCount: payload.snackSimpleCount,
      snackReplacementCount: payload.snackReplacementCount,
      waterBottleCount: payload.waterBottleCount,
      lodgingCount: payload.lodgingCount,
      meterReading: payload.meterReading,
      waterLiters: payload.waterLiters,
      fuelLiters: payload.fuelLiters,
      wasteFillPercent: payload.wasteFillPercent,
      chlorineLevel: payload.chlorineLevel,
      phLevel: payload.phLevel,
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
      snackSimpleCount: payload.snackSimpleCount,
      snackReplacementCount: payload.snackReplacementCount,
      waterBottleCount: payload.waterBottleCount,
      lodgingCount: payload.lodgingCount,
      meterReading: payload.meterReading,
      waterLiters: payload.waterLiters,
      fuelLiters: payload.fuelLiters,
      wasteFillPercent: payload.wasteFillPercent,
      chlorineLevel: payload.chlorineLevel,
      phLevel: payload.phLevel,
      notes: payload.notes || null,
      createdById: user.id
    }
  });

  revalidatePath("/dashboard");
  revalidatePath("/carga-diaria");
  revalidatePath("/check-campamento");
  revalidatePath("/hsec");
  return { error: "", success: "Reporte guardado correctamente." };
}
