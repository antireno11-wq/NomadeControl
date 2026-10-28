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
    archivoId?: string | null;
  }>;
};

type ChecklistSnapshot = {
  /** apto | apto_con_observaciones | no_apto. Lo calcula el checklist. */
  resultado?: string;
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
  /** El archivo del documento, si se subió. */
  archivoId?: string | null;
};

export const STANDARD_DOCUMENT_TYPES = [
  { key: "DECRETO_80", label: "Decreto 80" },
  { key: "BARRA_INTERIOR", label: "Barra interior" },
  { key: "BARRA_EXTERIOR", label: "Barra exterior" },
  { key: "REVISION_TECNICA", label: "Revisión técnica" },
  { key: "SOAP", label: "SOAP" },
  { key: "PERMISO_CIRCULACION", label: "Permiso circulación" }
] as const;

/**
 * Los cinco vencimientos que viven en la ficha del vehículo. Un documento de
 * estos tipos actualiza esa fecha y se muestra en su misma línea: si no, la
 * revisión técnica aparecía dos veces, una con la fecha de la ficha y otra
 * con la del papel.
 */
export const CAMPO_DE_FICHA = {
  PERMISO_CIRCULACION: "circulationPermitDue",
  SOAP: "soapDue",
  REVISION_TECNICA: "technicalReviewDue",
  SEGURO: "insuranceDue",
  EXTINTOR: "extinguisherDue",
} as const;

export function documentLabelForType(type?: string) {
  if (type === "SEGURO") return "Seguro";
  if (type === "EXTINTOR") return "Extintor";
  return STANDARD_DOCUMENT_TYPES.find((item) => item.key === type)?.label ?? type ?? "Otro";
}

/** Un mismo papel renovado es la misma línea; "Otro" se distingue por nombre. */
function claveDocumento(d: { documentType?: string; name: string }) {
  return !d.documentType || d.documentType === "OTRO" ? `OTRO:${d.name}` : d.documentType;
}

export function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function daysUntil(target: Date, baseDate = new Date()) {
  const diff = startOfDay(target).getTime() - startOfDay(baseDate).getTime();
  return Math.floor(diff / DAY_MS);
}

export function collectVehicleExpiryItems(vehicle: BaseVehicleDates): VehicleExpiryItem[] {
  const baseItems: Array<Omit<VehicleExpiryItem, "expiresAt"> & { expiresAt: Date | null }> = [
    { key: "PERMISO_CIRCULACION", label: "Permiso circulación", expiresAt: vehicle.circulationPermitDue ?? null, alertDays: 45 },
    { key: "SOAP", label: "SOAP", expiresAt: vehicle.soapDue ?? null, alertDays: 30 },
    { key: "REVISION_TECNICA", label: "Revisión técnica", expiresAt: vehicle.technicalReviewDue ?? null, alertDays: 30 },
    { key: "SEGURO", label: "Seguro", expiresAt: vehicle.insuranceDue ?? null, alertDays: 30 },
    { key: "EXTINTOR", label: "Extintor", expiresAt: vehicle.extinguisherDue ?? null, alertDays: 30 }
  ];

  // El documento que vale de cada tipo es el que vence más tarde: una
  // renovación no deja la anterior marcando "vencido".
  const ultimo = new Map<string, NonNullable<BaseVehicleDates["documents"]>[number]>();
  for (const d of vehicle.documents ?? []) {
    const actual = ultimo.get(claveDocumento(d));
    if (!actual || d.expiresAt.getTime() >= actual.expiresAt.getTime()) ultimo.set(claveDocumento(d), d);
  }

  const items: VehicleExpiryItem[] = [];
  for (const base of baseItems) {
    const doc = ultimo.get(base.key);
    ultimo.delete(base.key);
    const expiresAt = base.expiresAt ?? doc?.expiresAt ?? null;
    if (!(expiresAt instanceof Date)) continue;
    items.push({ ...base, expiresAt, archivoId: doc?.archivoId ?? null });
  }

  for (const document of ultimo.values()) {
    items.push({
      key: claveDocumento(document),
      label: !document.documentType || document.documentType === "OTRO" ? document.name : documentLabelForType(document.documentType),
      expiresAt: document.expiresAt,
      alertDays: document.alertDays,
      archivoId: document.archivoId ?? null,
    });
  }

  return items.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
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

  // Un checklist NO APTO manda sobre todo lo demás: el vehículo puede tener
  // los papeles al día y aun así no debe salir con un neumático bajo el mínimo.
  if (checklist?.resultado === "no_apto") {
    return { label: "No apto para salir", tone: "danger" as const };
  }

  if (expired.length > 0 || checklistIssues > 0) {
    return { label: "Con alerta", tone: "danger" as const };
  }

  if (upcoming.length > 0) {
    return { label: "Por revisar", tone: "warn" as const };
  }

  return { label: "Operativo", tone: "ok" as const };
}
