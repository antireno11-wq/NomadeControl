import { db } from "@/lib/db";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SeveridadAlerta = "vencido" | "critico" | "medio" | "preventivo" | "ok";

export interface AlertaVencimiento {
  id: string;
  /** Categoría de origen para agrupar / filtrar */
  categoria: "trabajador" | "hsec" | "vehiculo" | "epp";
  /** Nombre del documento o item */
  nombre: string;
  /** Nombre de la entidad dueña (trabajador, vehículo, campamento) */
  entidad: string;
  /** ID de la entidad para construir links */
  entidadId: string;
  /** URL a la que navegar para ver el detalle */
  href: string;
  fechaVencimiento: Date;
  diasRestantes: number;
  severidad: SeveridadAlerta;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcularDias(fecha: Date, hoy: Date): number {
  const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const target = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  return Math.ceil((target - base) / (24 * 60 * 60 * 1000));
}

function severidad(dias: number): SeveridadAlerta {
  if (dias < 0) return "vencido";
  if (dias <= 7) return "critico";
  if (dias <= 30) return "medio";
  if (dias <= 60) return "preventivo";
  return "ok";
}

// ─── Colores / etiquetas para UI ─────────────────────────────────────────────

export const SEVERIDAD_BADGE: Record<SeveridadAlerta, { bg: string; color: string; label: string }> = {
  vencido:    { bg: "#fee2e2", color: "#991b1b", label: "Vencido" },
  critico:    { bg: "#ffedd5", color: "#9a3412", label: "≤ 7 días" },
  medio:      { bg: "#fef9c3", color: "#854d0e", label: "≤ 30 días" },
  preventivo: { bg: "#dbeafe", color: "#1d4ed8", label: "≤ 60 días" },
  ok:         { bg: "#dcfce7", color: "#166534", label: "Al día" },
};

export const SEVERIDAD_ICON: Record<SeveridadAlerta, string> = {
  vencido:    "⛔",
  critico:    "🔴",
  medio:      "🟠",
  preventivo: "🟡",
  ok:         "🟢",
};

// ─── Campos fijos de StaffMember con fechas ───────────────────────────────────

const STAFF_DATE_FIELDS: { key: string; label: string }[] = [
  { key: "contractEndDate",       label: "Contrato" },
  { key: "driversLicenseDueDate", label: "Licencia de conducir" },
  { key: "altitudeExamDueDate",   label: "Examen de altura" },
  { key: "occupationalExamDueDate", label: "Examen ocupacional" },
  { key: "inductionDueDate",      label: "Inducción" },
  { key: "accreditationDueDate",  label: "Acreditación faena" },
];

// ─── Función principal ────────────────────────────────────────────────────────

export interface GetAlertasOptions {
  /** Solo alertas con severidad en este set. Omitir = todas incluyendo 'ok' */
  severidades?: SeveridadAlerta[];
  /** Filtrar por campamento (para jefaturas de terreno) */
  campId?: string;
  /** Solo documentos de un trabajador específico */
  staffMemberId?: string;
  /** Excluir los que están 'ok' (comportamiento por defecto en el dashboard) */
  excludeOk?: boolean;
}

export async function getAlertasVencimiento(opts: GetAlertasOptions = {}): Promise<AlertaVencimiento[]> {
  const hoy = new Date();
  const alertas: AlertaVencimiento[] = [];

  // ── 1. Documentos de trabajadores (tabla DocumentoTrabajador) ──────────────
  const docsWorkers = await db.documentoTrabajador.findMany({
    where: {
      fechaVencimiento: { not: null },
      ...(opts.staffMemberId ? { staffMemberId: opts.staffMemberId } : {}),
      ...(opts.campId
        ? { staffMember: { campId: opts.campId, isActive: true } }
        : { staffMember: { isActive: true } }),
    },
    select: {
      id: true,
      nombre: true,
      tipo: true,
      fechaVencimiento: true,
      staffMember: { select: { id: true, fullName: true } },
    },
  });

  for (const d of docsWorkers) {
    if (!d.fechaVencimiento) continue;
    const dias = calcularDias(d.fechaVencimiento, hoy);
    const sev = severidad(dias);
    if (opts.excludeOk && sev === "ok") continue;
    if (opts.severidades && !opts.severidades.includes(sev)) continue;
    alertas.push({
      id: `dtrab-${d.id}`,
      categoria: "trabajador",
      nombre: d.nombre,
      entidad: d.staffMember.fullName,
      entidadId: d.staffMember.id,
      href: `/trabajadores/${d.staffMember.id}/documentos`,
      fechaVencimiento: d.fechaVencimiento,
      diasRestantes: dias,
      severidad: sev,
    });
  }

  // ── 2. Fechas fijas en StaffMember (contrato, licencia, exámenes) ──────────
  if (!opts.staffMemberId) {
    const staffMembers = await db.staffMember.findMany({
      where: {
        isActive: true,
        ...(opts.campId ? { campId: opts.campId } : {}),
      },
      select: {
        id: true,
        fullName: true,
        contractEndDate: true,
        driversLicenseDueDate: true,
        altitudeExamDueDate: true,
        occupationalExamDueDate: true,
        inductionDueDate: true,
        accreditationDueDate: true,
      },
    });

    for (const sm of staffMembers) {
      for (const field of STAFF_DATE_FIELDS) {
        const fecha = sm[field.key as keyof typeof sm] as Date | null;
        if (!fecha) continue;
        const dias = calcularDias(fecha, hoy);
        const sev = severidad(dias);
        if (opts.excludeOk && sev === "ok") continue;
        if (opts.severidades && !opts.severidades.includes(sev)) continue;
        alertas.push({
          id: `staff-${sm.id}-${field.key}`,
          categoria: "trabajador",
          nombre: field.label,
          entidad: sm.fullName,
          entidadId: sm.id,
          href: `/trabajadores/${sm.id}`,
          fechaVencimiento: fecha,
          diasRestantes: dias,
          severidad: sev,
        });
      }
    }
  }

  // ── 3. Documentos HSEC del campamento ──────────────────────────────────────
  const docsHSEC = await db.documentoHSEC.findMany({
    where: {
      fechaVencimiento: { not: null },
      ...(opts.campId ? { campId: opts.campId } : {}),
    },
    select: {
      id: true,
      nombre: true,
      tipo: true,
      fechaVencimiento: true,
      camp: { select: { id: true, name: true } },
    },
  });

  for (const d of docsHSEC) {
    if (!d.fechaVencimiento) continue;
    const dias = calcularDias(d.fechaVencimiento, hoy);
    const sev = severidad(dias);
    if (opts.excludeOk && sev === "ok") continue;
    if (opts.severidades && !opts.severidades.includes(sev)) continue;
    alertas.push({
      id: `hsec-${d.id}`,
      categoria: "hsec",
      nombre: d.nombre,
      entidad: d.camp.name,
      entidadId: d.camp.id,
      href: "/hsec/documentos",
      fechaVencimiento: d.fechaVencimiento,
      diasRestantes: dias,
      severidad: sev,
    });
  }

  // ── 4. Documentos de vehículos ─────────────────────────────────────────────
  const docsVehiculos = await db.vehicleDocument.findMany({
    where: {
      ...(opts.campId
        ? { vehicle: { assignedCampId: opts.campId } }
        : {}),
    },
    select: {
      id: true,
      name: true,
      expiresAt: true,
      vehicle: { select: { id: true, plate: true, brand: true, model: true } },
    },
  });

  for (const d of docsVehiculos) {
    const dias = calcularDias(d.expiresAt, hoy);
    const sev = severidad(dias);
    if (opts.excludeOk && sev === "ok") continue;
    if (opts.severidades && !opts.severidades.includes(sev)) continue;
    alertas.push({
      id: `veh-${d.id}`,
      categoria: "vehiculo",
      nombre: d.name,
      entidad: `${d.vehicle.brand} ${d.vehicle.model} (${d.vehicle.plate})`,
      entidadId: d.vehicle.id,
      href: `/vehiculos/${d.vehicle.id}`,
      fechaVencimiento: d.expiresAt,
      diasRestantes: dias,
      severidad: sev,
    });
  }

  // ── Ordenar: vencidos primero, luego por proximidad ───────────────────────
  return alertas.sort((a, b) => a.diasRestantes - b.diasRestantes);
}

// ─── Resumen para el dashboard ────────────────────────────────────────────────

export interface ResumenAlertas {
  vencidos: number;
  criticos: number;
  medios: number;
  preventivos: number;
  total: number;
}

export function resumirAlertas(alertas: AlertaVencimiento[]): ResumenAlertas {
  const counts = { vencidos: 0, criticos: 0, medios: 0, preventivos: 0 };
  for (const a of alertas) {
    if (a.severidad === "vencido") counts.vencidos++;
    else if (a.severidad === "critico") counts.criticos++;
    else if (a.severidad === "medio") counts.medios++;
    else if (a.severidad === "preventivo") counts.preventivos++;
  }
  return { ...counts, total: counts.vencidos + counts.criticos + counts.medios + counts.preventivos };
}
