"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, isSupervisorRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDisplayDate, normalizeDateOnly } from "@/lib/report-utils";

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
  fuelLiters: z.coerce.number().int().min(0),
  fuelRemainingLiters: z.coerce.number().int().min(0),
  generator1Hours: z.coerce.number().min(0),
  generator2Hours: z.coerce.number().min(0),
  internetStatus: z.enum(["FUNCIONANDO", "CON_INTERRUPCIONES", "NO_FUNCIONA"]),
  blackWaterRemoved: z.enum(["SI", "NO"]),
  blackWaterRemovedM3: z.coerce.number().int().min(0).max(40),
  potableWaterTankLevelPercent: z.coerce.number().int().min(0).max(100),
  blackWaterTankLevelPercent: z.coerce.number().int().min(0).max(100),
  potableWaterDelivered: z.enum(["SI", "NO"]),
  potableWaterDeliveredM3: z.coerce.number().int().min(0).max(40),
  wasteFillPercent: z.coerce.number().int().min(0).max(100),
  chlorineLevel: z.coerce.number().min(0),
  phLevel: z.coerce.number().min(0),
  notes: z.string().optional()
});

export type ReportFormState = {
  error: string;
  success: string;
};

async function recalculateCampWaterLitersFromDate(campId: string, startDate: Date) {
  const [previousReport, reportsToRecalculate] = await Promise.all([
    db.dailyReport.findFirst({
      where: {
        campId,
        date: { lt: startDate }
      },
      orderBy: { date: "desc" },
      select: { meterReading: true }
    }),
    db.dailyReport.findMany({
      where: {
        campId,
        date: { gte: startDate }
      },
      orderBy: { date: "asc" },
      select: {
        id: true,
        meterReading: true,
        waterLiters: true
      }
    })
  ]);

  let previousMeterReading = previousReport?.meterReading ?? null;
  const updates = reportsToRecalculate
    .map((report) => {
      const computedWaterLiters = previousMeterReading === null
        ? 0
        : Math.max(0, Math.round(report.meterReading - previousMeterReading));

      previousMeterReading = report.meterReading;

      if (computedWaterLiters === report.waterLiters) {
        return null;
      }

      return db.dailyReport.update({
        where: { id: report.id },
        data: { waterLiters: computedWaterLiters }
      });
    })
    .filter((operation): operation is ReturnType<typeof db.dailyReport.update> => operation !== null);

  if (updates.length > 0) {
    await db.$transaction(updates);
  }
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function saveReportAction(_: ReportFormState, formData: FormData): Promise<ReportFormState> {
  const user = await requireUser();
  const reportId = String(formData.get("reportId") ?? "").trim() || undefined;

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
    fuelLiters: formData.get("fuelLiters"),
    fuelRemainingLiters: formData.get("fuelRemainingLiters"),
    generator1Hours: formData.get("generator1Hours"),
    generator2Hours: formData.get("generator2Hours"),
    internetStatus: formData.get("internetStatus"),
    blackWaterRemoved: formData.get("blackWaterRemoved"),
    blackWaterRemovedM3: formData.get("blackWaterRemovedM3"),
    potableWaterTankLevelPercent: formData.get("potableWaterTankLevelPercent"),
    blackWaterTankLevelPercent: formData.get("blackWaterTankLevelPercent"),
    potableWaterDelivered: formData.get("potableWaterDelivered"),
    potableWaterDeliveredM3: formData.get("potableWaterDeliveredM3"),
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
  const blackWaterRemovedM3 = payload.blackWaterRemoved === "SI" ? payload.blackWaterRemovedM3 : 0;
  const potableWaterDeliveredM3 = payload.potableWaterDelivered === "SI" ? payload.potableWaterDeliveredM3 : 0;
  const reportBeingEdited = reportId
    ? await db.dailyReport.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          campId: true,
          date: true,
          createdById: true
        }
      })
    : null;

  if (reportId && !reportBeingEdited) {
    return { error: "No encontramos el informe que intentas editar.", success: "" };
  }

  if (reportBeingEdited && reportBeingEdited.createdById !== user.id) {
    return { error: "Solo el usuario que creó este informe puede editarlo.", success: "" };
  }

  if (payload.blackWaterRemoved === "SI" && blackWaterRemovedM3 < 1) {
    return { error: "Indica los m3 retirados de aguas negras.", success: "" };
  }

  if (payload.potableWaterDelivered === "SI" && potableWaterDeliveredM3 < 1) {
    return { error: "Indica los m3 ingresados de agua potable.", success: "" };
  }

  if (isSupervisorRole(user.role)) {
    if (!user.campId) {
      return { error: "Tu usuario supervisor no tiene campamento asignado.", success: "" };
    }
    if (payload.campId !== user.campId) {
      return { error: "Solo puedes cargar información de tu campamento asignado.", success: "" };
    }
    if (reportBeingEdited && reportBeingEdited.campId !== user.campId) {
      return { error: "No puedes editar informes de otro campamento.", success: "" };
    }
  }

  const [existingReportOnTargetDate, previousReport, nextReport] = await Promise.all([
    db.dailyReport.findUnique({
      where: {
        campId_date: {
          campId: payload.campId,
          date
        }
      },
      select: {
        id: true,
        createdById: true
      }
    }),
    db.dailyReport.findFirst({
      where: {
        campId: payload.campId,
        date: { lt: date },
        ...(reportBeingEdited ? { id: { not: reportBeingEdited.id } } : {})
      },
      orderBy: { date: "desc" },
      select: { meterReading: true, date: true }
    }),
    db.dailyReport.findFirst({
      where: {
        campId: payload.campId,
        date: { gt: date },
        ...(reportBeingEdited ? { id: { not: reportBeingEdited.id } } : {})
      },
      orderBy: { date: "asc" },
      select: { meterReading: true, date: true }
    })
  ]);

  if (!reportBeingEdited && existingReportOnTargetDate) {
    return existingReportOnTargetDate.createdById === user.id
      ? { error: "Ya existe un informe para esa fecha. Corrígelo desde el botón Editar del historial.", success: "" }
      : { error: "Ya existe un informe en esa fecha y solo lo puede editar quien lo creó.", success: "" };
  }

  if (reportBeingEdited && existingReportOnTargetDate && existingReportOnTargetDate.id !== reportBeingEdited.id) {
    return existingReportOnTargetDate.createdById === user.id
      ? { error: "Ya tienes otro informe en esa fecha. Edita ese registro directamente.", success: "" }
      : { error: "Ya existe otro informe en esa fecha y no puedes reemplazarlo.", success: "" };
  }

  if (previousReport && payload.meterReading < previousReport.meterReading) {
    return {
      error: `La lectura del medidor no puede ser menor a la del ${formatDisplayDate(previousReport.date)}.`,
      success: ""
    };
  }

  if (nextReport && payload.meterReading > nextReport.meterReading) {
    return {
      error: `La lectura del medidor no puede ser mayor a la del ${formatDisplayDate(nextReport.date)} porque desordena el histórico.`,
      success: ""
    };
  }

  const computedWaterLiters = previousReport
    ? Math.max(0, Math.round(payload.meterReading - previousReport.meterReading))
    : 0;

  const reportData = {
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
    waterLiters: computedWaterLiters,
    fuelLiters: payload.fuelLiters,
    fuelRemainingLiters: payload.fuelRemainingLiters,
    generator1Hours: payload.generator1Hours,
    generator2Hours: payload.generator2Hours,
    internetStatus: payload.internetStatus,
    blackWaterRemoved: payload.blackWaterRemoved === "SI",
    blackWaterRemovedM3,
    potableWaterTankLevelPercent: payload.potableWaterTankLevelPercent,
    blackWaterTankLevelPercent: payload.blackWaterTankLevelPercent,
    potableWaterDelivered: payload.potableWaterDelivered === "SI",
    potableWaterDeliveredM3,
    wasteFillPercent: payload.wasteFillPercent,
    chlorineLevel: payload.chlorineLevel,
    phLevel: payload.phLevel,
    notes: payload.notes || null
  };

  const savedReport = reportBeingEdited
    ? await db.dailyReport.update({
        where: { id: reportBeingEdited.id },
        data: reportData
      })
    : await db.dailyReport.create({
        data: {
          ...reportData,
          createdById: user.id
        }
      });

  const recalcStartDate = reportBeingEdited && reportBeingEdited.date < date ? reportBeingEdited.date : date;
  await recalculateCampWaterLitersFromDate(payload.campId, recalcStartDate);

  revalidatePath("/dashboard");
  revalidatePath("/carga-diaria");
  revalidatePath("/hsec");
  revalidatePath(`/informes/${savedReport.id}`);
  revalidatePath(`/informes/${savedReport.id}/editar`);
  return {
    error: "",
    success: reportBeingEdited
      ? `Informe diario del ${payload.date} actualizado correctamente.`
      : `Informe diario del ${payload.date} guardado correctamente.`
  };
}
