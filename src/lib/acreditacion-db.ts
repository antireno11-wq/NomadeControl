import { db } from "@/lib/db";
import {
  calcularEstado,
  esEstadoOk,
  seleccionarVigentes,
  UMBRAL_POR_VENCER_DIAS,
  type EstadoDocumento,
} from "@/lib/acreditacion";

export type TipoDocumentoRow = {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  etiquetaCorta: string | null;
  vigenciaDias: number | null;
  mostrarEnMatriz: boolean;
  legacyField: string | null;
  orden: number;
};

export type DocumentoVigente = {
  id: string;
  fechaEmision: Date | null;
  fechaVencimiento: Date | null;
  sinVencimiento: boolean;
  vencimientoCalculado: boolean;
  origen: string;
  confianzaExtraccion: string | null;
  tieneArchivo: boolean;
  nota: string | null;
  createdAt: Date;
};

export type EstadoPorTipo = {
  tipoId: string;
  documento: DocumentoVigente | null;
  estado: EstadoDocumento;
  dias: number | null;
};

export type EstadoTrabajador = {
  staffMemberId: string;
  porTipo: Map<string, EstadoPorTipo>;
  vencidos: number;
  porVencer: number;
  sinFecha: number;
  ok: number;
};

/** Catálogo activo, ordenado. */
export async function getTiposDocumento(soloMatriz = false): Promise<TipoDocumentoRow[]> {
  const tipos = await db.tipoDocumento.findMany({
    where: { activo: true, ...(soloMatriz ? { mostrarEnMatriz: true } : {}) },
    orderBy: { orden: "asc" },
    select: {
      id: true, codigo: true, nombre: true, categoria: true,
      etiquetaCorta: true, vigenciaDias: true, mostrarEnMatriz: true,
      legacyField: true, orden: true,
    },
  });
  return tipos;
}

/**
 * Estado documental de un conjunto de trabajadores.
 *
 * Trae todos los documentos no anulados de esos trabajadores, elige el
 * vigente por (trabajador, tipo) y calcula el estado contra `hoy`.
 * Los tipos sin ningún documento quedan como `sin_fecha`.
 */
export async function getEstadoDocumental(
  staffMemberIds: string[],
  tipos: TipoDocumentoRow[],
  hoy = new Date(),
  umbralDias = UMBRAL_POR_VENCER_DIAS,
): Promise<Map<string, EstadoTrabajador>> {
  const resultado = new Map<string, EstadoTrabajador>();
  const tipoIds = new Set(tipos.map(t => t.id));

  // Base: todos los trabajadores con todos los tipos en sin_fecha
  for (const id of staffMemberIds) {
    const porTipo = new Map<string, EstadoPorTipo>();
    for (const t of tipos) {
      porTipo.set(t.id, { tipoId: t.id, documento: null, estado: "sin_fecha", dias: null });
    }
    resultado.set(id, {
      staffMemberId: id, porTipo,
      vencidos: 0, porVencer: 0, sinFecha: tipos.length, ok: 0,
    });
  }

  if (staffMemberIds.length === 0) return resultado;

  const documentos = await db.documentoAcreditacion.findMany({
    where: { staffMemberId: { in: staffMemberIds }, anulado: false },
    select: {
      id: true, staffMemberId: true, tipoDocumentoId: true,
      fechaEmision: true, fechaVencimiento: true, sinVencimiento: true,
      vencimientoCalculado: true, anulado: true, origen: true,
      confianzaExtraccion: true, nota: true, createdAt: true,
      archivoUrl: true,
      // No traemos `contenido` (Bytes) — pesa y no se usa acá.
    },
  });

  const vigentes = seleccionarVigentes(documentos);

  for (const [clave, doc] of vigentes) {
    const [staffMemberId, tipoDocumentoId] = clave.split("|");
    if (!tipoIds.has(tipoDocumentoId)) continue;

    const entry = resultado.get(staffMemberId);
    if (!entry) continue;

    const { estado, dias } = calcularEstado(doc, hoy, umbralDias);
    entry.porTipo.set(tipoDocumentoId, {
      tipoId: tipoDocumentoId,
      documento: {
        id: doc.id,
        fechaEmision: doc.fechaEmision,
        fechaVencimiento: doc.fechaVencimiento,
        sinVencimiento: doc.sinVencimiento,
        vencimientoCalculado: doc.vencimientoCalculado,
        origen: doc.origen,
        confianzaExtraccion: doc.confianzaExtraccion,
        tieneArchivo: Boolean(doc.archivoUrl),
        nota: doc.nota,
        createdAt: doc.createdAt,
      },
      estado,
      dias,
    });
  }

  // Recuento por trabajador
  for (const entry of resultado.values()) {
    let vencidos = 0, porVencer = 0, sinFecha = 0, ok = 0;
    for (const e of entry.porTipo.values()) {
      if (e.estado === "vencido") vencidos++;
      else if (e.estado === "por_vencer") porVencer++;
      else if (e.estado === "sin_fecha") sinFecha++;
      else if (esEstadoOk(e.estado)) ok++;
    }
    entry.vencidos = vencidos;
    entry.porVencer = porVencer;
    entry.sinFecha = sinFecha;
    entry.ok = ok;
  }

  return resultado;
}

/**
 * Sincroniza las columnas planas de la ficha hacia `Documento`.
 *
 * Se llama después de crear/editar un trabajador desde el formulario. Si
 * una fecha cambió respecto del documento vigente, crea una fila nueva
 * (append-only: la versión anterior queda como historial).
 *
 * Vaciar una fecha en el formulario NO anula el documento vigente — para
 * eso hay que anularlo explícitamente. Así un borrado accidental en el
 * form no destruye el registro.
 */
export async function sincronizarDesdeFicha(
  staffMemberId: string,
  actor?: { id?: string; nombre?: string },
): Promise<number> {
  const worker = await db.staffMember.findUnique({
    where: { id: staffMemberId },
    select: {
      id: true, contractIsIndefinite: true,
      contractEndDate: true, cedulaExpiryDate: true, driversLicenseDueDate: true,
      occupationalExamDueDate: true, altitudeExamDueDate: true,
      foodHandlingExamDueDate: true, vaccineDueDate: true,
      inductionDueDate: true, accreditationDueDate: true,
    },
  });
  if (!worker) return 0;

  const tipos = await db.tipoDocumento.findMany({
    where: { activo: true, legacyField: { not: null } },
    select: { id: true, legacyField: true },
  });
  if (tipos.length === 0) return 0; // catálogo aún no sembrado

  const existentes = await db.documentoAcreditacion.findMany({
    where: {
      staffMemberId,
      anulado: false,
      tipoDocumentoId: { in: tipos.map(t => t.id) },
    },
    select: {
      id: true, staffMemberId: true, tipoDocumentoId: true,
      fechaVencimiento: true, sinVencimiento: true, anulado: true, createdAt: true,
    },
  });
  const vigentes = seleccionarVigentes(existentes);

  const nuevos: Array<Record<string, unknown>> = [];

  for (const tipo of tipos) {
    const legacyField = tipo.legacyField!;
    const fecha = (worker as unknown as Record<string, Date | null>)[legacyField] ?? null;
    const esContrato = legacyField === "contractEndDate";
    const indefinido = esContrato && worker.contractIsIndefinite;

    if (!fecha && !indefinido) continue;

    const vigente = vigentes.get(`${staffMemberId}|${tipo.id}`);
    const mismoIndefinido = Boolean(vigente?.sinVencimiento) === Boolean(indefinido);
    const mismaFecha =
      (vigente?.fechaVencimiento?.getTime() ?? null) === (indefinido ? null : fecha?.getTime() ?? null);

    if (vigente && mismoIndefinido && mismaFecha) continue; // sin cambios

    nuevos.push({
      staffMemberId,
      tipoDocumentoId: tipo.id,
      fechaVencimiento: indefinido ? null : fecha,
      sinVencimiento: Boolean(indefinido),
      vencimientoCalculado: false,
      origen: "manual",
      confirmadoPorId: actor?.id ?? null,
      confirmadoPorNombre: actor?.nombre ?? null,
      confirmadoAt: new Date(),
      nota: "Cargado desde la ficha del trabajador",
    });
  }

  if (nuevos.length === 0) return 0;
  const res = await db.documentoAcreditacion.createMany({ data: nuevos as never });
  return res.count;
}

/**
 * Historial completo de un tipo para un trabajador (todas las versiones,
 * incluidas anuladas). Para la ficha del trabajador.
 */
export async function getHistorialDocumento(staffMemberId: string, tipoDocumentoId: string) {
  return db.documentoAcreditacion.findMany({
    where: { staffMemberId, tipoDocumentoId },
    orderBy: [{ fechaVencimiento: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, fechaEmision: true, fechaVencimiento: true,
      sinVencimiento: true, vencimientoCalculado: true, origen: true,
      confianzaExtraccion: true, confirmadoPorNombre: true, confirmadoAt: true,
      anulado: true, anuladoPorNombre: true, anuladoAt: true, motivoAnulacion: true,
      nota: true, originalFilename: true, fileSize: true, mimeType: true,
      archivoUrl: true, createdAt: true,
    },
  });
}
