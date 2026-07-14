"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, ADMIN_ROLES, type AppRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

const STAFF_MANAGER_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

const SHIFT_MAP: Record<string, { work: number; off: number }> = {
  "14x14": { work: 14, off: 14 },
  "10x10": { work: 10, off: 10 },
  "7x7":   { work: 7,  off: 7  },
  "4x3":   { work: 4,  off: 3  },
};

export type WorkerImportRow = {
  fullName:                 string;
  nationalId?:              string;
  role?:                    string;
  employerCompany?:         string;
  phone?:                   string;
  personalEmail?:           string;
  campamento?:              string;
  shiftPattern?:            string;
  shiftStartDate?:          string;
  contractEndDate?:         string;
  contractIsIndefinite?:    string; // "true" | "1" | "on" | "indefinido" | ...
  driversLicenseDueDate?:   string;
  altitudeExamDueDate?:     string;
  occupationalExamDueDate?: string;
  accreditationDueDate?:    string;
  inductionDueDate?:        string;
  cedulaExpiryDate?:        string;
  foodHandlingExamDueDate?: string;
  vaccineDueDate?:          string;
  notes?:                   string;
};

export type ImportMode = "create" | "update" | "sync";

export type ImportResult = {
  mode: ImportMode;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ fila: number; nombre: string; error: string }>;
};

function parseDate(s?: string): Date | null {
  if (!s?.trim()) return null;
  const parts = s.trim().split(/[\/\-\.]/);
  if (parts.length === 3) {
    let d: Date;
    if (parts[0].length === 4) {
      d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    } else {
      d = new Date(Date.UTC(+parts[2], +parts[1] - 1, +parts[0]));
    }
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Normaliza un RUT chileno para matching (saca puntos, guiones, mayúsculas)
function normalizeRut(rut?: string): string {
  return (rut ?? "").replace(/[.\-\s]/g, "").toUpperCase();
}

function isTruthyFlag(v?: string): boolean {
  if (!v) return false;
  const s = v.toLowerCase().trim();
  return ["true", "1", "on", "si", "sí", "yes", "indefinido"].includes(s);
}

/**
 * Cuando actualizamos, solo tocamos los campos que VIENEN con valor en el
 * Excel. Un campo vacío o ausente se mantiene sin tocar. Esto evita que una
 * columna en blanco borre datos ya cargados en la ficha.
 */
function buildUpdatePayload(row: WorkerImportRow, campId: string | null) {
  const payload: Record<string, unknown> = {};

  // Campos de texto: solo si viene con valor no vacío
  const strFields: Array<[keyof WorkerImportRow, string]> = [
    ["fullName", "fullName"],
    ["nationalId", "nationalId"],
    ["role", "role"],
    ["employerCompany", "employerCompany"],
    ["phone", "phone"],
    ["personalEmail", "personalEmail"],
    ["notes", "notes"],
  ];
  for (const [src, dst] of strFields) {
    const v = row[src]?.toString().trim();
    if (v) payload[dst] = v;
  }

  // Campamento: solo lo sobreescribimos si el Excel trae uno explícito
  if (campId !== null && (row.campamento?.trim() || campId)) {
    payload.campId = campId;
  }

  // Turno: solo si viene válido
  if (row.shiftPattern && SHIFT_MAP[row.shiftPattern]) {
    const rule = SHIFT_MAP[row.shiftPattern];
    payload.shiftPattern = row.shiftPattern;
    payload.shiftWorkDays = rule.work;
    payload.shiftOffDays = rule.off;
  }
  const shiftStart = parseDate(row.shiftStartDate);
  if (shiftStart) payload.shiftStartDate = shiftStart;

  // Contrato indefinido: si viene el flag explícito
  if (row.contractIsIndefinite && row.contractIsIndefinite.trim()) {
    const isInd = isTruthyFlag(row.contractIsIndefinite);
    payload.contractIsIndefinite = isInd;
    if (isInd) payload.contractEndDate = null;
  }

  // Fechas de documentos: solo si vienen con valor parseable
  const dateFields: Array<[keyof WorkerImportRow, string]> = [
    ["contractEndDate", "contractEndDate"],
    ["driversLicenseDueDate", "driversLicenseDueDate"],
    ["altitudeExamDueDate", "altitudeExamDueDate"],
    ["occupationalExamDueDate", "occupationalExamDueDate"],
    ["accreditationDueDate", "accreditationDueDate"],
    ["inductionDueDate", "inductionDueDate"],
    ["cedulaExpiryDate", "cedulaExpiryDate"],
    ["foodHandlingExamDueDate", "foodHandlingExamDueDate"],
    ["vaccineDueDate", "vaccineDueDate"],
  ];
  for (const [src, dst] of dateFields) {
    const raw = row[src]?.toString().trim();
    if (raw) {
      const parsed = parseDate(raw);
      if (parsed) payload[dst] = parsed;
    }
  }

  return payload;
}

export async function importarTrabajadoresAction(
  rows: WorkerImportRow[],
  defaultCampId?: string,
  mode: ImportMode = "create",
): Promise<ImportResult> {
  const user = await requireRole(STAFF_MANAGER_ROLES);

  const camps = await db.camp.findMany({ select: { id: true, name: true } });
  const campMap = new Map(camps.map(c => [c.name.toLowerCase().trim(), c.id]));

  const result: ImportResult = { mode, created: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fila = i + 2; // la fila 1 es el header

    if (!row.fullName?.trim() && !row.nationalId?.trim()) {
      result.skipped++;
      continue;
    }

    try {
      const campId = row.campamento
        ? (campMap.get(row.campamento.toLowerCase().trim()) ?? null)
        : (defaultCampId ?? null);

      // Buscar existente por RUT normalizado (si viene RUT)
      const rutNorm = normalizeRut(row.nationalId);
      let existing: { id: string; nationalId: string | null } | null = null;
      if (rutNorm) {
        // Traemos varios candidatos y matcheamos por rut normalizado
        const candidates = await db.staffMember.findMany({
          where: { nationalId: { not: null } },
          select: { id: true, nationalId: true },
        });
        existing = candidates.find(c => normalizeRut(c.nationalId ?? "") === rutNorm) ?? null;
      }

      if (existing) {
        if (mode === "create") {
          result.errors.push({
            fila,
            nombre: row.fullName ?? row.nationalId ?? "",
            error: "Ya existe (modo Crear salta duplicados). Usá modo Actualizar o Sincronizar.",
          });
          continue;
        }
        // update o sync → actualizamos
        const patch = buildUpdatePayload(row, campId);
        if (Object.keys(patch).length === 0) {
          result.skipped++;
          continue;
        }
        await db.staffMember.update({
          where: { id: existing.id },
          data: patch,
        });
        result.updated++;
      } else {
        if (mode === "update") {
          result.errors.push({
            fila,
            nombre: row.fullName ?? row.nationalId ?? "",
            error: "No existe (modo Actualizar requiere RUT ya registrado)",
          });
          continue;
        }
        // create o sync → creamos
        const shiftPattern = row.shiftPattern?.trim() ?? "14x14";
        const shift = SHIFT_MAP[shiftPattern] ?? SHIFT_MAP["14x14"];
        const shiftStartDate = parseDate(row.shiftStartDate) ?? new Date();

        await db.staffMember.create({
          data: {
            fullName:                row.fullName.trim(),
            nationalId:              row.nationalId?.trim()       || null,
            role:                    row.role?.trim()             || null,
            employerCompany:         row.employerCompany?.trim()  || null,
            phone:                   row.phone?.trim()            || null,
            personalEmail:           row.personalEmail?.trim()    || null,
            campId,
            shiftPattern,
            shiftWorkDays:           shift.work,
            shiftOffDays:            shift.off,
            shiftStartDate,
            contractIsIndefinite:    isTruthyFlag(row.contractIsIndefinite),
            contractEndDate:         isTruthyFlag(row.contractIsIndefinite) ? null : parseDate(row.contractEndDate),
            driversLicenseDueDate:   parseDate(row.driversLicenseDueDate),
            altitudeExamDueDate:     parseDate(row.altitudeExamDueDate),
            occupationalExamDueDate: parseDate(row.occupationalExamDueDate),
            accreditationDueDate:    parseDate(row.accreditationDueDate),
            inductionDueDate:        parseDate(row.inductionDueDate),
            cedulaExpiryDate:        parseDate(row.cedulaExpiryDate),
            foodHandlingExamDueDate: parseDate(row.foodHandlingExamDueDate),
            vaccineDueDate:          parseDate(row.vaccineDueDate),
            notes:                   row.notes?.trim()            || null,
            isActive:                true,
            createdById:             user.id,
          },
        });
        result.created++;
      }
    } catch (e) {
      result.errors.push({
        fila,
        nombre: row.fullName ?? row.nationalId ?? "",
        error: (e as Error).message.includes("Unique")
          ? "Ya existe un trabajador con ese RUT"
          : (e as Error).message,
      });
    }
  }

  if (result.created > 0 || result.updated > 0) {
    await logAuditEvent({
      actorUserId: user.id, actorName: user.name, actorEmail: user.email,
      action: mode === "create" ? "TRABAJADOR_IMPORT" : mode === "update" ? "TRABAJADOR_BULK_UPDATE" : "TRABAJADOR_SYNC",
      entityType: "staffMember",
      entityId: "bulk",
      summary: `Import Excel (modo ${mode}): ${result.created} creados, ${result.updated} actualizados`,
    });
    revalidatePath("/trabajadores");
    revalidatePath("/trabajadores/control-documental");
  }

  return result;
}
