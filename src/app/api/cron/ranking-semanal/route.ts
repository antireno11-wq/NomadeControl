import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendRankingSemanalEmail, type FilaRanking } from "@/lib/mailer";
import { logAuditEvent } from "@/lib/audit";
import { fechaEfectiva } from "@/lib/ddd";

const DIA_MS = 86_400_000;

/**
 * Responsables que no son una persona. Sus pendientes van al bloque aparte:
 * meterlos en el ranking los pondría compitiendo por el primer lugar con
 * gente de carne y hueso, y lo que hay que hacer con ellos es asignarlos.
 */
const SIN_DUENO = new Set(["por definir", "sin asignar", "sin responsable", "todos", "equipo", ""]);

function clave(nombre: string): string {
  return nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim();
}

function diasDesde(fecha: Date, hoy: Date): number {
  const a = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const b = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  return Math.round((a - b) / DIA_MS);
}

/**
 * Ranking semanal de pendientes atrasados, a la oficina central.
 *
 * "Oficina central" son los usuarios activos sin campamento asignado: quien
 * está en faena tiene su propio tablero y no necesita el panorama completo.
 * Se excluyen los correos de otros dominios —contadores, asesores— porque un
 * ranking interno con nombres y atrasos de la gente no es algo que se manda
 * afuera sin decidirlo.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`. `?dryRun=1` simula.
 * `?forzar=1` lo manda de nuevo aunque ya haya salido hoy.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const provided =
    (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "") ||
    (req.nextUrl.searchParams.get("token") ?? "");

  if (process.env.NODE_ENV === "production") {
    if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 500 });
    if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else if (secret && provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const forzar = req.nextUrl.searchParams.get("forzar") === "1";
  const hoy = new Date();
  const haceUnaSemana = new Date(hoy.getTime() - 7 * DIA_MS);

  // ── Ya salió hoy? ──────────────────────────────────────────────────────
  // El barrido se intenta varias veces porque el cron de GitHub se salta
  // ejecuciones. Sin esta guarda, los lunes que sí corre llegarían cuatro
  // copias del mismo ranking.
  const inicioDelDia = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
  const yaSalio = await db.auditLog.findFirst({
    where: { action: "RANKING_SEMANAL_SENT", createdAt: { gte: inicioDelDia } },
    select: { id: true, createdAt: true },
  });

  // ── Destinatarios: oficina central ─────────────────────────────────────
  const oficina = await db.user.findMany({
    where: { isActive: true, campId: null },
    select: { name: true, email: true },
  });

  const dominioPropio = (process.env.DOMINIO_INTERNO ?? "nomadechile.cl").toLowerCase();
  const destinatarios = oficina
    .map(u => u.email.toLowerCase())
    .filter(e => e.endsWith(`@${dominioPropio}`));
  const excluidos = oficina
    .map(u => u.email.toLowerCase())
    .filter(e => !e.endsWith(`@${dominioPropio}`));

  // ── Los tres tableros ──────────────────────────────────────────────────
  const [tareas, compromisos, amenazas, usuarios] = await Promise.all([
    db.tarea.findMany({
      where: { estado: { not: "completada" }, fechaCierre: { lt: hoy } },
      select: { responsable: true, fechaCierre: true },
    }),
    db.compromiso.findMany({
      where: { estado: 0 },
      select: { responsable: true, fechaCierre: true, fecha2doCompromiso: true, estado: true },
    }),
    db.amenaza.findMany({
      where: { estado: 0, fechaCierre: { lt: hoy } },
      select: { responsable: true, fechaCierre: true },
    }),
    db.user.findMany({ where: { isActive: true }, select: { name: true } }),
  ]);

  const conCuenta = new Set(usuarios.map(u => clave(u.name)));

  type Acum = FilaRanking & { clave: string };
  const porPersona = new Map<string, Acum>();
  const sinDueno = { tareas: 0, compromisos: 0, amenazas: 0, total: 0 };

  const sumar = (
    responsable: string | null,
    tipo: "tareas" | "compromisos" | "amenazas",
    plazo: Date,
  ) => {
    const nombre = (responsable ?? "").trim();
    const k = clave(nombre);
    const atraso = diasDesde(plazo, hoy);

    if (!nombre || SIN_DUENO.has(k)) {
      sinDueno[tipo]++; sinDueno.total++;
      return;
    }

    const actual = porPersona.get(k) ?? {
      clave: k, nombre, tieneCuenta: conCuenta.has(k),
      tareas: 0, compromisos: 0, amenazas: 0, total: 0,
      peorAtraso: 0, cerradosSemana: 0,
    };
    actual[tipo]++;
    actual.total++;
    actual.peorAtraso = Math.max(actual.peorAtraso, atraso);
    porPersona.set(k, actual);
  };

  for (const t of tareas) sumar(t.responsable, "tareas", t.fechaCierre!);
  for (const a of amenazas) sumar(a.responsable, "amenazas", a.fechaCierre);
  for (const c of compromisos) {
    const plazo = fechaEfectiva(c);
    if (diasDesde(plazo, hoy) <= 0) continue;
    sumar(c.responsable, "compromisos", plazo);
  }

  // ── Cerrados en los últimos 7 días ─────────────────────────────────────
  // Va al lado del atraso para que la lista se pueda leer sin injusticia:
  // quien toma diez y cierra ocho no puede aparecer peor que quien no tomó
  // ninguna.
  const [tCerradas, cCerrados, aCerradas] = await Promise.all([
    db.tarea.findMany({
      where: { estado: "completada", fechaCompletada: { gte: haceUnaSemana } },
      select: { responsable: true },
    }),
    db.compromiso.findMany({
      where: { estado: 1, fechaCierreReal: { gte: haceUnaSemana } },
      select: { responsable: true },
    }),
    db.amenaza.findMany({
      where: { estado: 1, fechaCierreReal: { gte: haceUnaSemana } },
      select: { responsable: true },
    }),
  ]);

  let cerradosSemana = 0;
  for (const r of [...tCerradas, ...cCerrados, ...aCerradas]) {
    cerradosSemana++;
    const k = clave(r.responsable ?? "");
    const fila = porPersona.get(k);
    // Solo se le suma a quien además tiene atrasos: el ranking es de
    // atrasados, y agregar filas en cero de gente al día lo vuelve ilegible.
    if (fila) fila.cerradosSemana++;
  }

  const filas = [...porPersona.values()]
    .sort((a, b) => b.total - a.total || b.peorAtraso - a.peorAtraso)
    .map(({ clave: _k, ...f }) => f);

  const totalAtrasados = filas.reduce((s, f) => s + f.total, 0) + sinDueno.total;

  const semanaLabel = `semana del ${hoy.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })}`;

  // ── Enviar ─────────────────────────────────────────────────────────────
  let envio: { ok: boolean; error?: string } | null = null;

  if (!dryRun && (!yaSalio || forzar) && destinatarios.length > 0) {
    envio = await sendRankingSemanalEmail({
      to: destinatarios, semanaLabel, filas, sinDueno, totalAtrasados, cerradosSemana,
    });

    if (envio.ok) {
      await logAuditEvent({
        actorName: "system-cron", actorEmail: "system@nomadecontrol",
        action: "RANKING_SEMANAL_SENT", entityType: "system",
        summary: `Envió el ranking semanal a ${destinatarios.length} persona(s) de oficina central — ${totalAtrasados} atrasados`,
        metadata: { destinatarios, totalAtrasados, personas: filas.length, sinDueno: sinDueno.total },
      }).catch(() => {});
    }
  }

  const fallo = envio != null && !envio.ok;

  return NextResponse.json({
    ok: !fallo,
    dryRun,
    yaHabiaSalidoHoy: Boolean(yaSalio),
    enviado: envio?.ok ?? false,
    error: envio?.error,
    destinatarios,
    excluidosPorSerExternos: excluidos,
    totalAtrasados,
    cerradosUltimos7Dias: cerradosSemana,
    sinDueno,
    ranking: filas,
  }, { status: fallo ? 500 : 200 });
}

export const GET = POST;
