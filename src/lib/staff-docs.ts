export const STAFF_DOCUMENT_FIELDS = [
  { key: "contractEndDate", label: "Contrato" },
  { key: "altitudeExamDueDate", label: "Examen altura" },
  { key: "occupationalExamDueDate", label: "Examen ocupacional" },
  { key: "inductionDueDate", label: "Inducción" },
  { key: "accreditationDueDate", label: "Acreditación" },
  { key: "driversLicenseDueDate", label: "Licencia" }
] as const;

export type StaffDocumentFieldKey = (typeof STAFF_DOCUMENT_FIELDS)[number]["key"];

export type StaffDocumentCarrier = Partial<Record<StaffDocumentFieldKey, Date | null>>;

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntilDate(target?: Date | null, referenceDate = new Date()) {
  if (!target) return null;

  const base = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  const value = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()));
  return Math.ceil((value.getTime() - base.getTime()) / DAY_MS);
}

export function getStaffDocumentEntries(staffMember: StaffDocumentCarrier, referenceDate = new Date()) {
  return STAFF_DOCUMENT_FIELDS.map((field) => {
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
