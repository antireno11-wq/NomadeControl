"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, isSupervisorRole, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
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
  const user = await requireRole(TRABAJADORES_ROLES);

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

// ─── Renovar contrato ─────────────────────────────────────────────────────────

export async function renovarContratoAction(formData: FormData) {
  const user = await requireRole(TRABAJADORES_ROLES);
  const staffMemberId = formData.get("staffMemberId");
  const nuevaFecha    = formData.get("nuevaFechaContrato");

  if (typeof staffMemberId !== "string" || !staffMemberId) throw new Error("Trabajador inválido.");
  if (typeof nuevaFecha !== "string" || !nuevaFecha) throw new Error("Fecha requerida.");

  const worker = await db.staffMember.findUnique({ where: { id: staffMemberId }, select: { id: true, fullName: true, campId: true } });
  if (!worker) throw new Error("Trabajador no encontrado.");
  if (isSupervisorRole(user.role) && worker.campId !== user.campId) throw new Error("Sin permiso.");

  const fecha = normalizeDateOnly(nuevaFecha);

  await db.staffMember.update({
    where: { id: staffMemberId },
    data: { contractEndDate: fecha, isActive: true },
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "UPDATE_WORKER", entityType: "staffMember", entityId: staffMemberId,
    summary: `Renovó contrato de ${worker.fullName} hasta ${nuevaFecha}`,
  });

  revalidatePath(`/trabajadores/${staffMemberId}`);
  redirect(`/trabajadores/${staffMemberId}?tab=contrato&status=renovado`);
}

// ─── Terminar contrato + evaluación de salida ─────────────────────────────────

const cierreSchema = z.object({
  staffMemberId:           z.string().min(1),
  tipo:                    z.enum(["finiquito", "no_renovacion", "renuncia", "mutuo_acuerdo", "otro"]),
  fechaCierre:             z.string().min(1),
  motivoCierre:            z.string().optional(),
  desempenoGeneral:        z.enum(["excelente", "bueno", "regular", "malo"]),
  puntualidad:             z.enum(["buena", "regular", "mala"]),
  trabajoEnEquipo:         z.enum(["bueno", "regular", "malo"]),
  calidadTrabajo:          z.enum(["buena", "regular", "mala"]),
  actitudSeguridad:        z.enum(["buena", "regular", "mala"]),
  recontratarRecomendado:  z.string(),   // "on" | ""
  prioridadRecontratacion: z.enum(["inmediata", "normal", "baja", "no_aplica"]).optional(),
  observaciones:           z.string().optional(),
});

export async function terminarContratoAction(formData: FormData) {
  const user = await requireRole(TRABAJADORES_ROLES);

  const parsed = cierreSchema.safeParse({
    staffMemberId:           formData.get("staffMemberId"),
    tipo:                    formData.get("tipo"),
    fechaCierre:             formData.get("fechaCierre"),
    motivoCierre:            formData.get("motivoCierre") ?? undefined,
    desempenoGeneral:        formData.get("desempenoGeneral"),
    puntualidad:             formData.get("puntualidad"),
    trabajoEnEquipo:         formData.get("trabajoEnEquipo"),
    calidadTrabajo:          formData.get("calidadTrabajo"),
    actitudSeguridad:        formData.get("actitudSeguridad"),
    recontratarRecomendado:  formData.get("recontratarRecomendado") ?? "",
    prioridadRecontratacion: formData.get("prioridadRecontratacion") ?? "normal",
    observaciones:           formData.get("observaciones") ?? undefined,
  });

  if (!parsed.success) throw new Error("Datos inválidos: " + parsed.error.issues.map(i => i.message).join(", "));
  const p = parsed.data;

  const worker = await db.staffMember.findUnique({ where: { id: p.staffMemberId }, select: { id: true, fullName: true, campId: true } });
  if (!worker) throw new Error("Trabajador no encontrado.");
  if (isSupervisorRole(user.role) && worker.campId !== user.campId) throw new Error("Sin permiso.");

  const fecha = normalizeDateOnly(p.fechaCierre);
  const recontratar = p.recontratarRecomendado === "on";

  await db.$transaction([
    db.staffMember.update({
      where: { id: p.staffMemberId },
      data: { isActive: false, contractEndDate: fecha },
    }),
    db.cierreContrato.upsert({
      where:  { staffMemberId: p.staffMemberId },
      update: {
        tipo: p.tipo, fechaCierre: fecha, motivoCierre: p.motivoCierre ?? null,
        desempenoGeneral: p.desempenoGeneral, puntualidad: p.puntualidad,
        trabajoEnEquipo: p.trabajoEnEquipo, calidadTrabajo: p.calidadTrabajo,
        actitudSeguridad: p.actitudSeguridad, recontratarRecomendado: recontratar,
        prioridadRecontratacion: p.prioridadRecontratacion ?? "normal",
        observaciones: p.observaciones ?? null, evaluadoPorNombre: user.name,
      },
      create: {
        staffMemberId: p.staffMemberId, tipo: p.tipo, fechaCierre: fecha,
        motivoCierre: p.motivoCierre ?? null, desempenoGeneral: p.desempenoGeneral,
        puntualidad: p.puntualidad, trabajoEnEquipo: p.trabajoEnEquipo,
        calidadTrabajo: p.calidadTrabajo, actitudSeguridad: p.actitudSeguridad,
        recontratarRecomendado: recontratar,
        prioridadRecontratacion: p.prioridadRecontratacion ?? "normal",
        observaciones: p.observaciones ?? null, evaluadoPorNombre: user.name,
      },
    }),
  ]);

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "UPDATE_WORKER", entityType: "staffMember", entityId: p.staffMemberId,
    summary: `Terminó contrato de ${worker.fullName} (${p.tipo}). Recontratar: ${recontratar ? "Sí" : "No"}`,
  });

  revalidatePath(`/trabajadores/${p.staffMemberId}`);
  revalidatePath("/trabajadores/ex-trabajadores");
  redirect(`/trabajadores/${p.staffMemberId}?tab=contrato&status=terminado`);
}
