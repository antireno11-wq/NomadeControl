"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, VEHICLE_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeDateOnly } from "@/lib/report-utils";

export type ActionState = { error: string; success: string };

const optionalDate = z.string().optional().transform((value) => {
  if (!value) return null;
  return normalizeDateOnly(value);
});

const vehicleSchema = z.object({
  plate: z.string().trim().min(5),
  company: z.string().trim().optional(),
  internalCode: z.string().trim().optional(),
  brand: z.string().trim().min(2),
  model: z.string().trim().min(1),
  year: z.coerce.number().int().min(1990).max(2100).optional(),
  type: z.string().trim().min(2),
  status: z.enum(["OPERATIVO", "MANTENCION", "FUERA_DE_SERVICIO"]),
  accreditationStatus: z.enum(["ACREDITADO", "PENDIENTE", "NO_ACREDITADO"]),
  odometerKm: z.coerce.number().int().min(0),
  assignedCampId: z.string().optional(),
  assignedProjectId: z.string().optional(),
  ownerArea: z.string().trim().optional(),
  color: z.string().trim().optional(),
  vin: z.string().trim().optional(),
  engineNumber: z.string().trim().optional(),
  circulationPermitDue: optionalDate,
  soapDue: optionalDate,
  technicalReviewDue: optionalDate,
  insuranceDue: optionalDate,
  extinguisherDue: optionalDate,
  gpsInstalled: z.string().optional(),
  gpsCertificatePresent: z.string().optional(),
  unitPhotoSet: z.string().optional(),
  winterKitPhotoSet: z.string().optional(),
  uvProtectionCertificate: z.string().optional(),
  reviewedByName: z.string().trim().optional(),
  reviewedAt: optionalDate,
  notes: z.string().trim().optional()
});

const updateVehicleSchema = vehicleSchema.extend({
  vehicleId: z.string().min(1)
});

const vehicleDocumentSchema = z.object({
  vehicleId: z.string().min(1),
  documentType: z.string().trim().min(2),
  name: z.string().trim().min(2),
  number: z.string().trim().optional(),
  issuer: z.string().trim().optional(),
  issuedAt: optionalDate,
  expiresAt: z.string().min(1).transform((value) => normalizeDateOnly(value)),
  alertDays: z.coerce.number().int().min(1).max(365),
  notes: z.string().trim().optional()
});

const checklistSchema = z.object({
  vehicleId: z.string().min(1),
  date: z.string().min(1),
  odometerKm: z.coerce.number().int().min(0),
  fuelPercent: z.coerce.number().int().min(0).max(100),
  observations: z.string().trim().optional(),
  incidentReported: z.string().optional(),
  frontLightsOk: z.string().optional(),
  rearLightsOk: z.string().optional(),
  tiresOk: z.string().optional(),
  brakesOk: z.string().optional(),
  mirrorsOk: z.string().optional(),
  hornOk: z.string().optional(),
  fluidsOk: z.string().optional(),
  jackOk: z.string().optional(),
  spareTireOk: z.string().optional(),
  extinguisherOk: z.string().optional(),
  documentsOk: z.string().optional(),
  bodyworkOk: z.string().optional(),
  cleanlinessOk: z.string().optional()
});

function normalizedCampId(value?: string) {
  return value && value !== "none" ? value : null;
}

function normalizedProjectId(value?: string) {
  return value && value !== "none" ? value : null;
}

function optionalField(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function checked(value?: string) {
  return value === "on";
}

export async function createVehicleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(ADMIN_ROLES);

    const parsed = vehicleSchema.safeParse({
      plate: formData.get("plate"),
      company: String(formData.get("company") ?? ""),
      internalCode: String(formData.get("internalCode") ?? ""),
      brand: formData.get("brand"),
      model: formData.get("model"),
      year: formData.get("year") === "" ? undefined : formData.get("year"),
      type: formData.get("type"),
      status: formData.get("status"),
      accreditationStatus: formData.get("accreditationStatus"),
      odometerKm: formData.get("odometerKm"),
      assignedCampId: optionalField(formData, "assignedCampId"),
      assignedProjectId: optionalField(formData, "assignedProjectId"),
      ownerArea: String(formData.get("ownerArea") ?? ""),
      color: String(formData.get("color") ?? ""),
      vin: String(formData.get("vin") ?? ""),
      engineNumber: String(formData.get("engineNumber") ?? ""),
      circulationPermitDue: String(formData.get("circulationPermitDue") ?? ""),
      soapDue: String(formData.get("soapDue") ?? ""),
      technicalReviewDue: String(formData.get("technicalReviewDue") ?? ""),
      insuranceDue: String(formData.get("insuranceDue") ?? ""),
      extinguisherDue: String(formData.get("extinguisherDue") ?? ""),
      gpsInstalled: optionalField(formData, "gpsInstalled"),
      gpsCertificatePresent: optionalField(formData, "gpsCertificatePresent"),
      unitPhotoSet: optionalField(formData, "unitPhotoSet"),
      winterKitPhotoSet: optionalField(formData, "winterKitPhotoSet"),
      uvProtectionCertificate: optionalField(formData, "uvProtectionCertificate"),
      reviewedByName: String(formData.get("reviewedByName") ?? ""),
      reviewedAt: String(formData.get("reviewedAt") ?? ""),
      notes: String(formData.get("notes") ?? "")
    });

    if (!parsed.success) return { error: "Datos inválidos para crear vehículo.", success: "" };

    const payload = parsed.data;
    const plate = payload.plate.toUpperCase();

    const existing = await db.vehicle.findUnique({ where: { plate } });
    if (existing) return { error: "Ya existe un vehículo con esa patente.", success: "" };

    await db.vehicle.create({
      data: {
        plate,
        company: payload.company || null,
        internalCode: payload.internalCode || null,
        brand: payload.brand,
        model: payload.model,
        year: payload.year ?? null,
        type: payload.type,
        status: payload.status,
        accreditationStatus: payload.accreditationStatus,
        odometerKm: payload.odometerKm,
        assignedCampId: normalizedCampId(payload.assignedCampId),
        assignedProjectId: normalizedProjectId(payload.assignedProjectId),
        ownerArea: payload.ownerArea || null,
        color: payload.color || null,
        vin: payload.vin || null,
        engineNumber: payload.engineNumber || null,
        circulationPermitDue: payload.circulationPermitDue,
        soapDue: payload.soapDue,
        technicalReviewDue: payload.technicalReviewDue,
        insuranceDue: payload.insuranceDue,
        extinguisherDue: payload.extinguisherDue,
        gpsInstalled: checked(payload.gpsInstalled),
        gpsCertificatePresent: checked(payload.gpsCertificatePresent),
        unitPhotoSet: checked(payload.unitPhotoSet),
        winterKitPhotoSet: checked(payload.winterKitPhotoSet),
        uvProtectionCertificate: checked(payload.uvProtectionCertificate),
        reviewedByName: payload.reviewedByName || null,
        reviewedAt: payload.reviewedAt,
        notes: payload.notes || null
      }
    });

    revalidatePath("/vehiculos");
    revalidatePath("/administracion");
    return { error: "", success: "Vehículo creado correctamente." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se pudo crear el vehículo.", success: "" };
  }
}

export async function updateVehicleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(ADMIN_ROLES);

    const parsed = updateVehicleSchema.safeParse({
      vehicleId: formData.get("vehicleId"),
      plate: formData.get("plate"),
      company: String(formData.get("company") ?? ""),
      internalCode: String(formData.get("internalCode") ?? ""),
      brand: formData.get("brand"),
      model: formData.get("model"),
      year: formData.get("year") === "" ? undefined : formData.get("year"),
      type: formData.get("type"),
      status: formData.get("status"),
      accreditationStatus: formData.get("accreditationStatus"),
      odometerKm: formData.get("odometerKm"),
      assignedCampId: optionalField(formData, "assignedCampId"),
      assignedProjectId: optionalField(formData, "assignedProjectId"),
      ownerArea: String(formData.get("ownerArea") ?? ""),
      color: String(formData.get("color") ?? ""),
      vin: String(formData.get("vin") ?? ""),
      engineNumber: String(formData.get("engineNumber") ?? ""),
      circulationPermitDue: String(formData.get("circulationPermitDue") ?? ""),
      soapDue: String(formData.get("soapDue") ?? ""),
      technicalReviewDue: String(formData.get("technicalReviewDue") ?? ""),
      insuranceDue: String(formData.get("insuranceDue") ?? ""),
      extinguisherDue: String(formData.get("extinguisherDue") ?? ""),
      gpsInstalled: optionalField(formData, "gpsInstalled"),
      gpsCertificatePresent: optionalField(formData, "gpsCertificatePresent"),
      unitPhotoSet: optionalField(formData, "unitPhotoSet"),
      winterKitPhotoSet: optionalField(formData, "winterKitPhotoSet"),
      uvProtectionCertificate: optionalField(formData, "uvProtectionCertificate"),
      reviewedByName: String(formData.get("reviewedByName") ?? ""),
      reviewedAt: String(formData.get("reviewedAt") ?? ""),
      notes: String(formData.get("notes") ?? "")
    });

    if (!parsed.success) return { error: "Datos inválidos para actualizar vehículo.", success: "" };

    const payload = parsed.data;
    const plate = payload.plate.toUpperCase();

    const duplicate = await db.vehicle.findFirst({ where: { plate, NOT: { id: payload.vehicleId } } });
    if (duplicate) return { error: "Ya existe otro vehículo con esa patente.", success: "" };

    await db.vehicle.update({
      where: { id: payload.vehicleId },
      data: {
        plate,
        company: payload.company || null,
        internalCode: payload.internalCode || null,
        brand: payload.brand,
        model: payload.model,
        year: payload.year ?? null,
        type: payload.type,
        status: payload.status,
        accreditationStatus: payload.accreditationStatus,
        odometerKm: payload.odometerKm,
        assignedCampId: normalizedCampId(payload.assignedCampId),
        assignedProjectId: normalizedProjectId(payload.assignedProjectId),
        ownerArea: payload.ownerArea || null,
        color: payload.color || null,
        vin: payload.vin || null,
        engineNumber: payload.engineNumber || null,
        circulationPermitDue: payload.circulationPermitDue,
        soapDue: payload.soapDue,
        technicalReviewDue: payload.technicalReviewDue,
        insuranceDue: payload.insuranceDue,
        extinguisherDue: payload.extinguisherDue,
        gpsInstalled: checked(payload.gpsInstalled),
        gpsCertificatePresent: checked(payload.gpsCertificatePresent),
        unitPhotoSet: checked(payload.unitPhotoSet),
        winterKitPhotoSet: checked(payload.winterKitPhotoSet),
        uvProtectionCertificate: checked(payload.uvProtectionCertificate),
        reviewedByName: payload.reviewedByName || null,
        reviewedAt: payload.reviewedAt,
        notes: payload.notes || null
      }
    });

    revalidatePath("/vehiculos");
    revalidatePath(`/vehiculos/${payload.vehicleId}`);
    return { error: "", success: "Vehículo actualizado correctamente." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se pudo actualizar el vehículo.", success: "" };
  }
}

export async function addVehicleDocumentAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireRole(ADMIN_ROLES);

    const parsed = vehicleDocumentSchema.safeParse({
      vehicleId: formData.get("vehicleId"),
      documentType: formData.get("documentType"),
      name: formData.get("name"),
      number: String(formData.get("number") ?? ""),
      issuer: String(formData.get("issuer") ?? ""),
      issuedAt: String(formData.get("issuedAt") ?? ""),
      expiresAt: String(formData.get("expiresAt") ?? ""),
      alertDays: formData.get("alertDays"),
      notes: String(formData.get("notes") ?? "")
    });

    if (!parsed.success) return { error: "Datos inválidos para agregar documento.", success: "" };

    const payload = parsed.data;
    await db.vehicleDocument.create({
      data: {
        vehicleId: payload.vehicleId,
        documentType: payload.documentType,
        name: payload.name,
        number: payload.number || null,
        issuer: payload.issuer || null,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        alertDays: payload.alertDays,
        notes: payload.notes || null
      }
    });

    revalidatePath("/vehiculos");
    revalidatePath(`/vehiculos/${payload.vehicleId}`);
    return { error: "", success: "Documento agregado correctamente." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se pudo agregar el documento.", success: "" };
  }
}

export async function saveVehicleChecklistAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireRole(VEHICLE_ROLES);

    const parsed = checklistSchema.safeParse({
      vehicleId: formData.get("vehicleId"),
      date: formData.get("date"),
      odometerKm: formData.get("odometerKm"),
      fuelPercent: formData.get("fuelPercent"),
      observations: String(formData.get("observations") ?? ""),
      incidentReported: optionalField(formData, "incidentReported"),
      frontLightsOk: optionalField(formData, "frontLightsOk"),
      rearLightsOk: optionalField(formData, "rearLightsOk"),
      tiresOk: optionalField(formData, "tiresOk"),
      brakesOk: optionalField(formData, "brakesOk"),
      mirrorsOk: optionalField(formData, "mirrorsOk"),
      hornOk: optionalField(formData, "hornOk"),
      fluidsOk: optionalField(formData, "fluidsOk"),
      jackOk: optionalField(formData, "jackOk"),
      spareTireOk: optionalField(formData, "spareTireOk"),
      extinguisherOk: optionalField(formData, "extinguisherOk"),
      documentsOk: optionalField(formData, "documentsOk"),
      bodyworkOk: optionalField(formData, "bodyworkOk"),
      cleanlinessOk: optionalField(formData, "cleanlinessOk")
    });

    if (!parsed.success) return { error: "Datos inválidos para el checklist.", success: "" };

    const payload = parsed.data;
    const date = normalizeDateOnly(payload.date);

    await db.vehicleChecklist.create({
      data: {
        vehicleId: payload.vehicleId,
        driverId: user.id,
        date,
        odometerKm: payload.odometerKm,
        fuelPercent: payload.fuelPercent,
        observations: payload.observations || null,
        incidentReported: checked(payload.incidentReported),
        frontLightsOk: checked(payload.frontLightsOk),
        rearLightsOk: checked(payload.rearLightsOk),
        tiresOk: checked(payload.tiresOk),
        brakesOk: checked(payload.brakesOk),
        mirrorsOk: checked(payload.mirrorsOk),
        hornOk: checked(payload.hornOk),
        fluidsOk: checked(payload.fluidsOk),
        jackOk: checked(payload.jackOk),
        spareTireOk: checked(payload.spareTireOk),
        extinguisherOk: checked(payload.extinguisherOk),
        documentsOk: checked(payload.documentsOk),
        bodyworkOk: checked(payload.bodyworkOk),
        cleanlinessOk: checked(payload.cleanlinessOk)
      }
    });

    await db.vehicle.update({
      where: { id: payload.vehicleId },
      data: { odometerKm: payload.odometerKm }
    });

    revalidatePath("/vehiculos");
    revalidatePath(`/vehiculos/${payload.vehicleId}`);
    return { error: "", success: "Checklist registrado correctamente." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se pudo registrar el checklist.", success: "" };
  }
}
