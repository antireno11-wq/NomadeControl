export const STAFF_DOCUMENT_FIELDS = [
  { key: "contractEndDate",         label: "Contrato",                      short: "Contrato" },
  { key: "cedulaExpiryDate",        label: "Carnet de identidad",           short: "C. identidad" },
  { key: "driversLicenseDueDate",   label: "Licencia de conducir",          short: "Licencia" },
  { key: "occupationalExamDueDate", label: "Examen ocupacional (mutualidad)", short: "Ocupacional" },
  { key: "altitudeExamDueDate",     label: "Examen de altura",              short: "Altura" },
  { key: "foodHandlingExamDueDate", label: "Manipulación alimentos",        short: "Aliment." },
  { key: "vaccineDueDate",          label: "Vacunas",                       short: "Vacunas" },
  { key: "inductionDueDate",        label: "Inducción",                     short: "Inducción" },
  { key: "accreditationDueDate",    label: "Acreditación",                  short: "Acredit." }
] as const;

/**
 * Cargo textual del contrato. Es distinto del grupo de dotación (`Cargo`),
 * que es el que decide qué documentos se exigen: "MONTAJISTA - GASFITER" y
 * "MONTAJISTA" son cargos distintos que se acreditan igual.
 */
export const STAFF_ROLE_OPTIONS = [
  "SUPERVISOR",
  "SUPERVISOR DE MONTAJE",
  "HSEC",
  "MAESTRO DE COCINA",
  "AYUDANTE DE COCINA",
  "AUXILIAR DE COCINA",
  "CAMPAMENTERO",
  "CHOFER",
  "MANTENCION",
  "MONTAJISTA",
  "MONTAJISTA - GASFITER"
] as const;

export type StaffDocumentFieldKey = (typeof STAFF_DOCUMENT_FIELDS)[number]["key"];

export type StaffDocumentCarrier = Partial<Record<StaffDocumentFieldKey, Date | null>> & {
  contractIsIndefinite?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntilDate(target?: Date | null, referenceDate = new Date()) {
  if (!target) return null;

  const base = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  const value = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()));
  return Math.ceil((value.getTime() - base.getTime()) / DAY_MS);
}

export function getStaffDocumentEntries(staffMember: StaffDocumentCarrier, referenceDate = new Date()) {
  return STAFF_DOCUMENT_FIELDS.map((field) => {
    // Contrato indefinido: caso especial — no vence
    if (field.key === "contractEndDate" && staffMember.contractIsIndefinite) {
      return {
        ...field,
        date: null,
        daysUntil: null,
        status: "indefinite",
      } as const;
    }

    const date = staffMember[field.key] ?? null;
    const daysUntil = daysUntilDate(date, referenceDate);
    return {
      ...field,
      date,
      daysUntil,
      status:
        daysUntil == null
          ? "missing"
          : daysUntil < 0
            ? "expired"
            : daysUntil <= 30
              ? "dueSoon"
              : "ok"
    } as const;
  });
}

export function getNearestDocument(staffMember: StaffDocumentCarrier, referenceDate = new Date()) {
  const datedEntries = getStaffDocumentEntries(staffMember, referenceDate).filter(
    (entry) => entry.date && entry.daysUntil != null
  );

  if (datedEntries.length === 0) return null;

  return datedEntries.sort((a, b) => (a.daysUntil ?? 99999) - (b.daysUntil ?? 99999))[0] ?? null;
}
