import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendCompromisosAtrasadosEmail, type CompromisoAtrasadoItem } from "@/lib/mailer";
import { logAuditEvent } from "@/lib/audit";
import { fechaEfectiva } from "@/lib/ddd";

/**
 * Umbrales, en días respecto del plazo. Positivo = antes de vencer.
 *
 * Se avisa 3 días antes y el día del plazo, y después a los 1, 3, 7, 15 y 30
 * días de atraso. Se corta ahí: un compromiso con más de un mes de atraso ya
 * no es un olvido, es una decisión, y seguir mandando correos al respecto no
 * lo cierra — solo entrena a la gente a archivar el aviso sin abrirlo.
 */
const UMBRALES = [3, 0, -1, -3, -7, -15, -30] as const;
const UMBRALES_ASC = [...UMBRALES].sort((a, b) => a - b);

/**
 * El umbral que a este compromiso le toca hoy, o `null` si ninguno.
 *
 * Devuelve el más cercano ya cruzado, no el que coincide exacto: si el
 * barrido no corre un día puntual, el aviso no se pierde.
 */
function umbralQueCorresponde(dias: number): number | null {
  return UMBRALES_ASC.find(t => dias <= t) ?? null;
}

const DIA_MS = 86_400_000;

function diasHasta(fecha: Date, hoy: Date): number {
  const a = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const b = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  return Math.round((b - a) / DIA_MS);
}

/**
 * Clave para cruzar el responsable con un usuario.
 *
 * El responsable se guarda como texto porque sale de la transcripción de la
 * reunión, así que llega escrito de cualquier forma: "manuel candia" y
 * "Manuel Candia" son 18 compromisos de la misma persona repartidos en dos
 * filas. Se compara sin tildes, sin mayúsculas y sin espacios de más.
 */
function claveNombre(nombre: string): string {
  return nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim();
}

/** Responsables que no son una persona: no se les puede avisar nada. */
const SIN_DUENO = new Set(["por definir", "sin asignar", "todos", "equipo", ""]);

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
  const hoy = new Date();
  const fechaLabel = hoy.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" });

  const supervision = (process.env.COMPROMISO_ALERT_EMAILS ?? "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

  // ── Compromisos abiertos que cruzaron algún umbral ─────────────────────
  const abiertos = await db.compromiso.findMany({
    where: { estado: 0 },
    select: {
      id: true, accion: true, responsable: true, estado: true,
      fechaCierre: true, fecha2doCompromiso: true,
      contrato: { select: { nombre: true } },
    },
  });

  type Pendiente = CompromisoAtrasadoItem & {
    id: string;
    fechaMedida: Date;
    umbral: number;
    clave: string;
  };

  const pendientes: Pendiente[] = [];

  for (const c of abiertos) {
    const plazo = fechaEfectiva(c);
    const dias = diasHasta(plazo, hoy);
    const umbral = umbralQueCorresponde(dias);
    if (umbral == null) continue;

    pendientes.push({
      id: c.id,
      accion: c.accion,
      responsable: c.responsable,
      dias,
      fechaCierre: plazo,
      reprogramado: c.fecha2doCompromiso != null,
      contrato: c.contrato?.nombre ?? null,
      fechaMedida: plazo,
      umbral,
      clave: claveNombre(c.responsable),
    });
  }

  pendientes.sort((a, b) => a.dias - b.dias);

  // ── Responsables que tienen usuario ────────────────────────────────────
  const usuarios = await db.user.findMany({
    where: { isActive: true },
    select: { name: true, email: true },
  });
  const correoPorNombre = new Map(usuarios.map(u => [claveNombre(u.name), u.email.toLowerCase()]));

  // ── Descartar lo ya avisado ────────────────────────────────────────────
  const yaEnviadas = pendientes.length === 0 ? [] : await db.alertaCompromiso.findMany({
    where: {
      OR: pendientes.flatMap(p => (["personal", "supervision"] as const).map(destino => ({
        compromisoId: p.id, fechaCierre: p.fechaMedida, umbral: p.umbral, destino,
      }))),
    },
    select: { compromisoId: true, fechaCierre: true, umbral: true, destino: true },
  });

  const enviadas = new Set(
    yaEnviadas.map(e => `${e.compromisoId}|${e.fechaCierre.toISOString()}|${e.umbral}|${e.destino}`),
  );
  const yaFue = (p: Pendiente, destino: string) =>
    enviadas.has(`${p.id}|${p.fechaMedida.toISOString()}|${p.umbral}|${destino}`);

  // ── Correo personal: a cada responsable lo suyo ────────────────────────
  const porResponsable = new Map<string, Pendiente[]>();
  const sinDestinatario: Pendiente[] = [];

  for (const p of pendientes) {
    if (yaFue(p, "personal")) continue;
    const correo = SIN_DUENO.has(p.clave) ? undefined : correoPorNombre.get(p.clave);
    if (!correo) { sinDestinatario.push(p); continue; }
    const lista = porResponsable.get(correo);
    if (lista) lista.push(p); else porResponsable.set(correo, [p]);
  }

  // ── Correo de supervisión: todo, incluido lo que no tiene dueño ────────
  const paraSupervision = pendientes.filter(p => !yaFue(p, "supervision"));

  const registros: Array<{ compromisoId: string; fechaCierre: Date; umbral: number; destino: string; recipients: string }> = [];
  const enviados: Array<{ a: string; cuantos: number; ok: boolean; error?: string }> = [];

  if (!dryRun) {
    for (const [correo, items] of porResponsable) {
      const nombre = items[0].responsable;
      const r = await sendCompromisosAtrasadosEmail({
        to: [correo], fechaLabel, items, paraQuien: nombre,
      });
      enviados.push({ a: correo, cuantos: items.length, ok: r.ok, error: r.error });
      // Solo se marca como avisado lo que de verdad salió. Si el correo
      // falló, mañana se vuelve a intentar en vez de darlo por hecho.
      if (r.ok) {
        for (const p of items) {
          registros.push({ compromisoId: p.id, fechaCierre: p.fechaMedida, umbral: p.umbral, destino: "personal", recipients: correo });
        }
      }
    }

    if (supervision.length > 0 && paraSupervision.length > 0) {
      const r = await sendCompromisosAtrasadosEmail({
        to: supervision, fechaLabel, items: paraSupervision,
      });
      enviados.push({ a: supervision.join(","), cuantos: paraSupervision.length, ok: r.ok, error: r.error });
      if (r.ok) {
        for (const p of paraSupervision) {
          registros.push({ compromisoId: p.id, fechaCierre: p.fechaMedida, umbral: p.umbral, destino: "supervision", recipients: supervision.join(",") });
        }
      }
    }

    if (registros.length > 0) {
      await db.alertaCompromiso.createMany({ data: registros, skipDuplicates: true });
      await logAuditEvent({
        actorName: "system-cron", actorEmail: "system@nomadecontrol",
        action: "COMPROMISO_ALERTS_SENT", entityType: "system",
        summary: `Avisó ${porResponsable.size} responsable(s) y ${supervision.length > 0 ? "la supervisión" : "nadie más"} sobre ${paraSupervision.length} compromiso(s)`,
        metadata: { umbrales: UMBRALES, personales: porResponsable.size, supervision: paraSupervision.length },
      }).catch(() => {});
    }
  }

  const fallaron = enviados.filter(e => !e.ok);

  return NextResponse.json({
    // Si algún correo falló, la respuesta NO es ok: la tarea programada
    // tiene que ponerse roja para que alguien lo mire.
    ok: fallaron.length === 0,
    dryRun,
    umbrales: UMBRALES,
    compromisosAbiertos: abiertos.length,
    cruces: pendientes.length,
    correosPersonales: porResponsable.size,
    supervision: supervision.length > 0 ? supervision : "sin configurar (COMPROMISO_ALERT_EMAILS)",
    paraSupervision: paraSupervision.length,
    // Los que nadie va a recibir por su cuenta. Es el dato que importa: un
    // compromiso de "Por definir" no se lo recuerda nadie.
    sinResponsableConCuenta: sinDestinatario.map(p => ({
      responsable: p.responsable, accion: p.accion.slice(0, 70), dias: p.dias,
    })),
    envios: enviados,
    errores: fallaron,
    detalle: pendientes.map(p => ({
      responsable: p.responsable,
      accion: p.accion.slice(0, 70),
      vence: p.fechaMedida.toISOString().slice(0, 10),
      dias: p.dias,
      umbral: p.umbral,
    })),
  }, { status: fallaron.length === 0 ? 200 : 500 });
}

export const GET = POST;
