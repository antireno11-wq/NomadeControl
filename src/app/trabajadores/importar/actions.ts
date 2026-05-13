"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

const SHIFT_MAP: Record<string, { work: number; off: number }> = {
  "14x14": { work: 14, off: 14 },
  "10x10": { work: 10, off: 10 },
  "7x7":   { work: 7,  off: 7  },
  "4x3":   { work: 4,  off: 3  },
};

export type WorkerImportRow = {
  fullName:                string;
  nationalId?:             string;
  role?:                   string;
  employerCompany?:        string;
  phone?:                  string;
  personalEmail?:          string;
  campamento?:             string;
  shiftPattern?:           string;
  shiftStartDate?:         string;
  contractEndDate?:        string;
  driversLicenseDueDate?:  string;
  altitudeExamDueDate?:    string;
  occupationalExamDueDate?: string;
  accreditationDueDate?:   string;
  notes?:                  string;
};

export type ImportResult = {
  created: number;
  skipped: number;
  errors: Array<{ fila: number; nombre: string; error: string }>;
};

function parseDate(s?: string): Date | null {
  if (!s?.trim()) return null;
  // Soporta DD/MM/YYYY, YYYY-MM-DD, y fechas serializadas de xlsx
  const parts = s.trim().split(/[\/\-\.]/);
  if (parts.length === 3) {
    let d: Date;
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    } else {
      // DD/MM/YYYY
      d = new Date(Date.UTC(+parts[2], +parts[1] - 1, +parts[0]));
    }
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function importarTrabajadoresAction(
  rows: WorkerImportRow[],
  defaultCampId?: string
): Promise<ImportResult> {
  const user = await requireRole(ADMIN_ROLES);

  const camps = await db.camp.findMany({ select: { id: true, name: true } });
  const campMap = new Map(
    camps.map(c => [c.name.toLowerCase().trim(), c.id])
  );

  const result: ImportResult = { created: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fila = i + 2; // +2 porque la fila 1 es el header

    if (!row.fullName?.trim()) {
      result.skipped++;
      continue;
    }

    try {
      const shiftPattern = row.shiftPattern?.trim() ?? "14x14";
      const shift = SHIFT_MAP[shiftPattern] ?? SHIFT_MAP["14x14"];

      const campId = row.campamento
        ? (campMap.get(row.campamento.toLowerCase().trim()) ?? null)
        : (defaultCampId ?? null);

      const shiftStartDate = parseDate(row.shiftStartDate) ?? new Date();

      await db.staffMember.create({
        data: {
          fullName:               row.fullName.trim(),
          nationalId:             row.nationalId?.trim()       || null,
          role:                   row.role?.trim()             || null,
          employerCompany:        row.employerCompany?.trim()  || null,
          phone:                  row.phone?.trim()            || null,
          personalEmail:          row.personalEmail?.trim()    || null,
          campId,
          shiftPattern,
          shiftWorkDays:          shift.work,
          shiftOffDays:           shift.off,
          shiftStartDate,
          contractEndDate:        parseDate(row.contractEndDate),
          driversLicenseDueDate:  parseDate(row.driversLicenseDueDate),
          altitudeExamDueDate:    parseDate(row.altitudeExamDueDate),
          occupationalExamDueDate: parseDate(row.occupationalExamDueDate),
          accreditationDueDate:   parseDate(row.accreditationDueDate),
          notes:                  row.notes?.trim()            || null,
          isActive:               true,
          createdById:            user.id,
        },
      });

      result.created++;
    } catch (e) {
      result.errors.push({
        fila,
        nombre: row.fullName,
        error: (e as Error).message.includes("Unique")
          ? "Ya existe un trabajador con ese RUT"
          : (e as Error).message,
      });
    }
  }

  if (result.created > 0) {
    await logAuditEvent({
      actorUserId: user.id, actorName: user.name, actorEmail: user.email,
      action: "TRABAJADOR_IMPORT",
      entityType: "staffMember",
      entityId: "bulk",
      summary: `Importó ${result.created} trabajadores desde Excel`,
    });
    revalidatePath("/trabajadores");
  }

  return result;
}
