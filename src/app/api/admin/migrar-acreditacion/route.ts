import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import {
  TIPOS_DOCUMENTO_SEED,
  LEGACY_FIELD_TO_CODIGO,
  DOCUMENTO_TRABAJADOR_TIPO_MAP,
} from "@/lib/acreditacion";

/**
 * Migración Fase A: unifica el modelo documental.
 *
 *  1. Siembra/actualiza el catálogo `TipoDocumento`
 *  2. Convierte las 9 columnas planas de StaffMember en filas de `Documento`
 *  3. Absorbe `DocumentoTrabajador` (adjuntos) en `Documento`
 *
 * Idempotente: usa `Documento.migradoDesde` (único) como llave de origen,
 * así que correrlo dos veces no duplica nada.
 *
 * Auth: sesión de administrador, o header/query con CRON_SECRET.
 * Uso:  GET /api/admin/migrar-acreditacion?dryRun=1   → simula
 *       POST /api/admin/migrar-acreditacion           → ejecuta
 *
 * NO borra nada: las columnas planas y `DocumentoTrabajador` quedan
 * intactas hasta verificar que la migración quedó bien.
 */

async function autorizado(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const byHeader = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const byQuery = req.nextUrl.searchParams.get("token") ?? "";
  if (secret && (byHeader === secret || byQuery === secret)) return true;

  const user = await getCurrentUser().catch(() => null);
  return Boolean(user && isAdminRole(user.role));
}

async function handler(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1" || req.method === "GET";

  // ── 1. Catálogo ──────────────────────────────────────────────────────
  let tiposCreados = 0;
  let tiposActualizados = 0;

  if (!dryRun) {
    for (const t of TIPOS_DOCUMENTO_SEED) {
      const existente = await db.tipoDocumento.findUnique({ where: { codigo: t.codigo } });
      if (existente) {
        // Respetamos ediciones manuales del admin: solo rellenamos lo
        // estructural que no debería cambiar (legacyField, categoria).
        await db.tipoDocumento.update({
          where: { codigo: t.codigo },
          data: { legacyField: t.legacyField, categoria: t.categoria },
        });
        tiposActualizados++;
      } else {
        await db.tipoDocumento.create({
          data: {
            codigo: t.codigo,
            nombre: t.nombre,
            categoria: t.categoria,
            vigenciaDias: t.vigenciaDias,
            requiereArchivo: t.requiereArchivo,
            mostrarEnMatriz: t.mostrarEnMatriz,
            etiquetaCorta: t.etiquetaCorta,
            legacyField: t.legacyField,
            orden: t.orden,
          },
        });
        tiposCreados++;
      }
    }
  } else {
    const existentes = await db.tipoDocumento.findMany({ select: { codigo: true } });
    const set = new Set(existentes.map(e => e.codigo));
    tiposCreados = TIPOS_DOCUMENTO_SEED.filter(t => !set.has(t.codigo)).length;
    tiposActualizados = TIPOS_DOCUMENTO_SEED.length - tiposCreados;
  }

  // Mapa codigo → id (después del seed)
  const tipos = await db.tipoDocumento.findMany({ select: { id: true, codigo: true } });
  const tipoIdPorCodigo = new Map(tipos.map(t => [t.codigo, t.id]));

  if (tipoIdPorCodigo.size === 0 && dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun,
      aviso: "El catálogo aún no existe. Corré el POST para sembrarlo y después revisá de nuevo.",
      tiposASembrar: TIPOS_DOCUMENTO_SEED.length,
    });
  }

  // ── 2. Columnas planas de StaffMember → Documento ────────────────────
  const workers = await db.staffMember.findMany({
    select: {
      id: true, fullName: true, contractIsIndefinite: true,
      contractEndDate: true, cedulaExpiryDate: true, driversLicenseDueDate: true,
      occupationalExamDueDate: true, altitudeExamDueDate: true,
      foodHandlingExamDueDate: true, vaccineDueDate: true,
      inductionDueDate: true, accreditationDueDate: true,
    },
  });

  const yaMigrados = new Set(
    (await db.documentoAcreditacion.findMany({
      where: { migradoDesde: { not: null } },
      select: { migradoDesde: true },
    })).map(d => d.migradoDesde!),
  );

  const pendientesColumnas: Array<Record<string, unknown>> = [];

  for (const w of workers) {
    for (const [legacyField, codigo] of Object.entries(LEGACY_FIELD_TO_CODIGO)) {
      const tipoDocumentoId = tipoIdPorCodigo.get(codigo);
      if (!tipoDocumentoId) continue;

      const fecha = (w as unknown as Record<string, Date | null>)[legacyField] ?? null;
      const esContrato = legacyField === "contractEndDate";
      const indefinido = esContrato && w.contractIsIndefinite;

      // Nada que migrar si no hay fecha y no es contrato indefinido
      if (!fecha && !indefinido) continue;

      const clave = `staff:${w.id}:${legacyField}`;
      if (yaMigrados.has(clave)) continue;

      pendientesColumnas.push({
        staffMemberId: w.id,
        tipoDocumentoId,
        fechaVencimiento: indefinido ? null : fecha,
        sinVencimiento: Boolean(indefinido),
        vencimientoCalculado: false,
        origen: "migracion",
        migradoDesde: clave,
        nota: "Migrado desde la ficha del trabajador (columna plana)",
      });
    }
  }

  // ── 3. DocumentoTrabajador (adjuntos) → Documento ────────────────────
  const adjuntos = await db.documentoTrabajador.findMany({
    select: {
      id: true, staffMemberId: true, tipo: true, nombre: true,
      contenido: true, originalFilename: true, fileSize: true, mimeType: true,
      fechaEmision: true, fechaVencimiento: true, notas: true,
      creadoPorNombre: true, createdAt: true,
    },
  });

  const pendientesAdjuntos: Array<Record<string, unknown>> = [];
  const adjuntosSinTipo: Array<{ id: string; tipo: string }> = [];

  for (const a of adjuntos) {
    const clave = `dt:${a.id}`;
    if (yaMigrados.has(clave)) continue;

    const codigo = DOCUMENTO_TRABAJADOR_TIPO_MAP[a.tipo];
    const tipoDocumentoId = codigo ? tipoIdPorCodigo.get(codigo) : undefined;

    if (!tipoDocumentoId) {
      // "otro" y cualquier tipo desconocido: no lo forzamos a una categoría
      // equivocada. Queda reportado para revisión manual.
      adjuntosSinTipo.push({ id: a.id, tipo: a.tipo });
      continue;
    }

    pendientesAdjuntos.push({
      staffMemberId: a.staffMemberId,
      tipoDocumentoId,
      fechaEmision: a.fechaEmision,
      fechaVencimiento: a.fechaVencimiento,
      sinVencimiento: false,
      vencimientoCalculado: false,
      contenido: a.contenido,
      originalFilename: a.originalFilename ?? a.nombre,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      origen: "migracion",
      confirmadoPorNombre: a.creadoPorNombre,
      confirmadoAt: a.createdAt,
      nota: a.notas,
      migradoDesde: clave,
      createdAt: a.createdAt,
    });
  }

  // ── Ejecutar ─────────────────────────────────────────────────────────
  let insertadosColumnas = 0;
  let insertadosAdjuntos = 0;

  if (!dryRun) {
    if (pendientesColumnas.length > 0) {
      const res = await db.documentoAcreditacion.createMany({
        data: pendientesColumnas as never,
        skipDuplicates: true,
      });
      insertadosColumnas = res.count;
    }
    // Los adjuntos van de a uno: `contenido` es Bytes y createMany con
    // blobs grandes puede reventar el límite de parámetros de Postgres.
    for (const d of pendientesAdjuntos) {
      try {
        await db.documentoAcreditacion.create({ data: d as never });
        insertadosAdjuntos++;
      } catch {
        // Duplicado por migradoDesde único — ignorar
      }
    }

    const user = await getCurrentUser().catch(() => null);
    await logAuditEvent({
      actorUserId: user?.id,
      actorName: user?.name ?? "system",
      actorEmail: user?.email ?? "system@nomadecontrol",
      action: "ACREDITACION_MIGRACION",
      entityType: "system",
      summary: `Migración Fase A: ${tiposCreados} tipos, ${insertadosColumnas} desde columnas, ${insertadosAdjuntos} adjuntos`,
      metadata: { tiposCreados, insertadosColumnas, insertadosAdjuntos, adjuntosSinTipo: adjuntosSinTipo.length },
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    catalogo: {
      creados: tiposCreados,
      actualizados: tiposActualizados,
      total: TIPOS_DOCUMENTO_SEED.length,
    },
    columnasPlanas: {
      trabajadoresRevisados: workers.length,
      documentosAMigrar: pendientesColumnas.length,
      insertados: insertadosColumnas,
    },
    adjuntos: {
      revisados: adjuntos.length,
      documentosAMigrar: pendientesAdjuntos.length,
      insertados: insertadosAdjuntos,
      sinTipoReconocido: adjuntosSinTipo.length,
      tiposNoReconocidos: Array.from(new Set(adjuntosSinTipo.map(a => a.tipo))),
    },
    nota: dryRun
      ? "Simulación — no se escribió nada. Hacé POST al mismo endpoint para ejecutar."
      : "Migración aplicada. Las columnas planas y DocumentoTrabajador quedan intactas como respaldo.",
  });
}

export const GET = handler;
export const POST = handler;
