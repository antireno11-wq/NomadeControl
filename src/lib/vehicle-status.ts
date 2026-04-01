const DAY_MS = 24 * 60 * 60 * 1000;

type BaseVehicleDates = {
  circulationPermitDue?: Date | null;
  soapDue?: Date | null;
  technicalReviewDue?: Date | null;
  insuranceDue?: Date | null;
  extinguisherDue?: Date | null;
  documents?: Array<{
    id?: string;
    documentType?: string;
    name: string;
    expiresAt: Date;
    alertDays: number;
  }>;
};

type ChecklistSnapshot = {
  incidentReported?: boolean;
  frontLightsOk?: boolean;
  rearLightsOk?: boolean;
  tiresOk?: boolean;
  brakesOk?: boolean;
  mirrorsOk?: boolean;
  hornOk?: boolean;
  fluidsOk?: boolean;
  jackOk?: boolean;
  spareTireOk?: boolean;
  extinguisherOk?: boolean;
  documentsOk?: boolean;
  bodyworkOk?: boolean;
  cleanlinessOk?: boolean;
};

export type VehicleExpiryItem = {
  key: string;
  label: string;
  expiresAt: Date;
  alertDays: number;
};

export const STANDARD_DOCUMENT_TYPES = [
  { key: "DECRETO_80", label: "Decreto 80" },
  { key: "BARRA_INTERIOR", label: "Barra interior" },
  { key: "BARRA_EXTERIOR", label: "Barra exterior" },
  { key: "REVISION_TECNICA", label: "Revisión técnica" },
  { key: "SOAP", label: "SOAP" },
  { key: "PERMISO_CIRCULACION", label: "Permiso circulación" }
] as const;

export function documentLabelForType(type?: string) {
  return STANDARD_DOCUMENT_TYPES.find((item) => item.key === type)?.label ?? type ?? "Otro";
}

export function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function daysUntil(target: Date, baseDate = new Date()) {
  const diff = startOfDay(target).getTime() - startOfDay(baseDate).getTime();
  return Math.floor(diff / DAY_MS);
}

export function collectVehicleExpiryItems(vehicle: BaseVehicleDates): VehicleExpiryItem[] {
  const baseItems: VehicleExpiryItem[] = [
    { key: "PERMISO_CIRCULACION", label: "Permiso circulación", expiresAt: vehicle.circulationPermitDue ?? null, alertDays: 45 },
    { key: "SOAP", label: "SOAP", expiresAt: vehicle.soapDue ?? null, alertDays: 30 },
    { key: "REVISION_TECNICA", label: "Revisión técnica", expiresAt: vehicle.technicalReviewDue ?? null, alertDays: 30 },
    { key: "SEGURO", label: "Seguro", expiresAt: vehicle.insuranceDue ?? null, alertDays: 30 },
    { key: "EXTINTOR", label: "Extintor", expiresAt: vehicle.extinguisherDue ?? null, alertDays: 30 }
  ].filter((item): item is VehicleExpiryItem => item.expiresAt instanceof Date);

  const customItems = (vehicle.documents ?? []).map((document) => ({
    key: document.documentType ?? document.name,
    label: documentLabelForType(document.documentType) ?? document.name,
    expiresAt: document.expiresAt,
    alertDays: document.alertDays
  }));

  return [...baseItems, ...customItems].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

export function summarizeVehicleExpiries(vehicle: BaseVehicleDates, baseDate = new Date()) {
  const items = collectVehicleExpiryItems(vehicle);
  const expired = items.filter((item) => daysUntil(item.expiresAt, baseDate) < 0);
  const upcoming = items.filter((item) => {
    const diff = daysUntil(item.expiresAt, baseDate);
    return diff >= 0 && diff <= item.alertDays;
  });

  return {
    items,
    expired,
    upcoming,
    next: items[0] ?? null
  };
}

export function summarizeByDocumentType(vehicles: BaseVehicleDates[], baseDate = new Date()) {
  return STANDARD_DOCUMENT_TYPES.map((type) => {
    const summary = { key: type.key, label: type.label, vigente: 0, porVencer: 0, vencido: 0, na: 0 };

    for (const vehicle of vehicles) {
      const item = collectVehicleExpiryItems(vehicle).find((entry) => entry.key === type.key);
      if (!item) {
        summary.na += 1;
        continue;
      }

      const diff = daysUntil(item.expiresAt, baseDate);
      if (diff < 0) {
        summary.vencido += 1;
      } else if (diff <= item.alertDays) {
        summary.porVencer += 1;
      } else {
        summary.vigente += 1;
      }
    }

    return summary;
  });
}

export function getChecklistIssueCount(checklist?: ChecklistSnapshot | null) {
  if (!checklist) return 0;

  const flags = [
    checklist.frontLightsOk,
    checklist.rearLightsOk,
    checklist.tiresOk,
    checklist.brakesOk,
    checklist.mirrorsOk,
    checklist.hornOk,
    checklist.fluidsOk,
    checklist.jackOk,
    checklist.spareTireOk,
    checklist.extinguisherOk,
    checklist.documentsOk,
    checklist.bodyworkOk,
    checklist.cleanlinessOk
  ];

  return flags.filter((flag) => flag === false).length + (checklist.incidentReported ? 1 : 0);
}

export function getVehicleHealthStatus(
  vehicle: BaseVehicleDates & { status: string },
  checklist?: ChecklistSnapshot | null,
  baseDate = new Date()
) {
  const { expired, upcoming } = summarizeVehicleExpiries(vehicle, baseDate);
  const checklistIssues = getChecklistIssueCount(checklist);

  if (vehicle.status === "FUERA_DE_SERVICIO") {
    return { label: "Fuera de servicio", tone: "danger" as const };
  }

  if (vehicle.status === "MANTENCION") {
    return { label: "Mantención", tone: "warn" as const };
  }

  if (expired.length > 0 || checklistIssues > 0) {
    return { label: "Con alerta", tone: "danger" as const };
  }

  if (upcoming.length > 0) {
    return { label: "Por revisar", tone: "warn" as const };
  }

  return { label: "Operativo", tone: "ok" as const };
}
