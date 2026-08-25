"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ADMIN_ROLES, requireRole, type AppRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { deInputDate, semanaIso, aInputDate, fechaEfectiva } from "@/lib/ddd";
import { getCategorias, getPersonasAsignables } from "@/lib/ddd-db";
import { extraerMinuta, VERSION_PROMPT, type PropuestaMinuta } from "@/lib/minuta-extractor";

const DDD_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

/**
 * Corre la extracción sobre el borrador y guarda la propuesta.
 *
 * Reemplaza la propuesta anterior, no la acumula: reprocesar dos veces tiene
 * que dar un resultado, no dos.
 */
async function procesar(reunionId: string): Promise<void> {
  const reunion = await db.reunion.findUnique({
    where: { id: reunionId },
    select: {
      id: true, fecha: true, tipo: true, participantes: true, transcripcion: true,
    },
  });
  if (!reunion?.transcripcion) return;

  const [categorias, personas, proyectos, compromisos, amenazas] = await Promise.all([
    getCategorias(),
    getPersonasAsignables(),
    db.proyecto.findMany({ where: { activo: true, ambito: "mandante" }, select: { nombre: true } }),
    db.compromiso.findMany({
      where: { estado: 0 },
      select: { id: true, accion: true, responsable: true, fechaCierre: true, fecha2doCompromiso: true },
    }),
    db.amenaza.findMany({
      where: { estado: 0 },
      select: { id: true, descripcion: true, responsable: true },
    }),
  ]);

  const propuesta = await extraerMinuta({
    fecha: aInputDate(reunion.fecha),
    tipo: reunion.tipo,
    participantes: reunion.participantes,
    contratos: proyectos.map(p => p.nombre),
    categorias: categorias.map(c => c.nombre),
    personas: personas.map(p => p.nombre),
    compromisosAbiertos: compromisos.map(c => ({
      id: c.id, accion: c.accion, responsable: c.responsable,
      vence: aInputDate(fechaEfectiva(c as never)),
    })),
    amenazasAbiertas: amenazas.map(a => ({
      id: a.id, descripcion: a.descripcion, responsable: a.responsable,
    })),
    transcripcion: reunion.transcripcion,
  });

  await db.reunion.update({
    where: { id: reunionId },
    data: {
      propuesta: propuesta as never,
      resumen: propuesta.resumen || undefined,
      modeloUsado: `gpt-4o-mini · ${VERSION_PROMPT}`,
    },
  });
}

export async function crearReunionAction(formData: FormData) {
  const user = await requireRole(DDD_ROLES);

  const tipo = String(formData.get("tipo") ?? "daily");
  const fecha = deInputDate(String(formData.get("fecha") ?? "")) ?? new Date();
  const referencia = String(formData.get("referencia") ?? "").trim() || null;
  const contratoId = String(formData.get("contratoId") ?? "").trim() || null;
  const transcripcion = String(formData.get("transcripcion") ?? "").trim();
  // Vienen de dos lados: las casillas de los usuarios activos y el campo
  // libre para quien no tiene cuenta. Se juntan y se deduplican.
  const participantes = [...new Set(
    formData.getAll("participantes")
      .map(String)
      .flatMap(v => v.split(/[,\n]/))
      .map(p => p.trim())
      .filter(Boolean),
  )];

  if (transcripcion.length < 40) redirect("/reuniones/nueva?status=corta");

  const { anio, semana } = semanaIso(fecha);
  const reunion = await db.reunion.create({
    data: {
      tipo, fecha, anio, semanaIso: semana, referencia, contratoId,
      participantes, transcripcion, estado: "borrador",
      creadaPorId: user.id, creadaPorNombre: user.name,
    },
    select: { id: true },
  });

  // La extracción corre acá y no en segundo plano: son minutos de trabajo del
  // usuario, no un proceso batch, y verla fallar en el momento es mejor que
  // descubrir media hora después que no se procesó.
  await procesar(reunion.id).catch(() => {});

  revalidatePath("/reuniones");
  redirect(`/reuniones/${reunion.id}`);
}

export async function reprocesarReunionAction(formData: FormData) {
  await requireRole(DDD_ROLES);
  const id = String(formData.get("reunionId") ?? "");
  if (!id) redirect("/reuniones");
  await procesar(id).catch(() => {});
  revalidatePath(`/reuniones/${id}`);
  redirect(`/reuniones/${id}?status=reprocesada`);
}

/** Guarda las ediciones que hizo la persona sobre la propuesta. */
export async function guardarPropuestaAction(
  reunionId: string,
  propuesta: PropuestaMinuta,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole(DDD_ROLES);
  } catch {
    return { ok: false, error: "Sin permisos" };
  }
  await db.reunion.update({
    where: { id: reunionId },
    data: { propuesta: propuesta as never, resumen: propuesta.resumen || undefined },
  });
  return { ok: true };
}

/**
 * Publica la minuta: recién acá se escriben los registros definitivos.
 *
 * Es idempotente: si la reunión ya está publicada no vuelve a escribir nada.
 * Una minuta que se publica dos veces por un doble clic duplicaría todos los
 * compromisos del día.
 */
export async function publicarReunionAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);
  const id = String(formData.get("reunionId") ?? "");
  if (!id) redirect("/reuniones");

  const reunion = await db.reunion.findUnique({
    where: { id },
    select: { id: true, fecha: true, estado: true, propuesta: true, contratoId: true },
  });
  if (!reunion) redirect("/reuniones?status=no-encontrada");
  if (reunion.estado === "publicada") redirect(`/reuniones/${id}?status=ya-publicada`);

  const p = (reunion.propuesta ?? {}) as PropuestaMinuta;
  const fechaCaptura = reunion.fecha;

  const alta = (s: string | null | undefined) => deInputDate(String(s ?? "")) ?? fechaCaptura;

  // Un compromiso que ya está abierto no se vuelve a crear. Si se procesa dos
  // veces el mismo daily —o el de hoy repite lo de ayer, que es lo normal en
  // una reunión diaria— cada publicación agregaba una copia. El tablero
  // terminaba con el mismo trabajo escrito tres veces y el cumplimiento
  // contando tres veces lo mismo.
  const norm = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

  const abiertos = await db.compromiso.findMany({
    where: { estado: 0 },
    select: { accion: true, responsable: true },
  });
  const yaAbierto = new Set(abiertos.map(a => `${norm(a.accion)}|${norm(a.responsable)}`));
  let omitidos = 0;

  await db.$transaction(async tx => {
    for (const c of p.compromisos_nuevos ?? []) {
      if (!c.accion?.trim()) continue;
      // Misma acción y mismo responsable: es el mismo compromiso, no uno nuevo.
      const clave = `${norm(c.accion)}|${norm(c.responsable || "Por definir")}`;
      if (yaAbierto.has(clave)) { omitidos++; continue; }
      yaAbierto.add(clave);
      await tx.compromiso.create({
        data: {
          reunionOrigenId: id, fechaCaptura,
          oportunidad: c.oportunidad || "Otro",
          accion: c.accion.trim(),
          responsable: c.responsable || "Por definir",
          contratoId: reunion.contratoId,
          fechaCierre: alta(c.fecha_cierre),
          observacion: c.observacion || null,
          requiereVerificacion: Boolean(c.requiere_verificacion),
          origen: "extraccion", evidencia: c.evidencia || null,
        },
      });
    }

    for (const a of p.amenazas_nuevas ?? []) {
      if (!a.descripcion?.trim()) continue;
      await tx.amenaza.create({
        data: {
          reunionOrigenId: id, fechaCaptura,
          area: a.area || "General", descripcion: a.descripcion.trim(),
          responsable: a.responsable || "Por definir",
          contratoId: reunion.contratoId,
          fechaCierre: alta(a.fecha_cierre),
          observacion: a.observacion || null,
          requiereVerificacion: Boolean(a.requiere_verificacion),
          evidencia: a.evidencia || null,
        },
      });
    }

    for (const r of p.rdp_nuevos ?? []) {
      if (!r.problema?.trim()) continue;
      await tx.rdp.create({
        data: {
          reunionOrigenId: id, fechaCaptura,
          problema: r.problema.trim(), causaRaiz: r.causa_raiz || null,
          accionCorrectiva: r.accion_correctiva || null,
          lider: r.lider || "Por definir",
          fechaCierre: alta(r.fecha_cierre), evidencia: r.evidencia || null,
        },
      });
    }

    for (const g of p.gemba_nuevos ?? []) {
      if (!g.descripcion?.trim()) continue;
      await tx.gemba.create({
        data: {
          reunionOrigenId: id, fechaCaptura,
          observador: g.observador || "Sin registrar", descripcion: g.descripcion.trim(),
          area: g.area || null, lider: g.lider || null,
          fechaCierre: alta(g.fecha_cierre), evidencia: g.evidencia || null,
        },
      });
    }

    // Cierres aceptados. Los dudosos NO se cierran: por eso están aparte.
    for (const c of p.cierres ?? []) {
      if (!c.id) continue;
      // Igual que al cerrar a mano, el cierre tiene que decir cómo se cerró.
      // Acá lo dice la cita de la transcripción, que además deja el rastro de
      // en qué reunión se dio por cerrado.
      const previo = await tx.compromiso.findUnique({
        where: { id: c.id }, select: { observacion: true, estado: true },
      });
      if (!previo || previo.estado !== 0) continue;

      const comoSeCerro = c.evidencia?.trim()
        ? `Cerrado en el daily: «${c.evidencia.trim()}»`
        : "Cerrado en el daily, sin cita en la transcripción";

      await tx.compromiso.update({
        where: { id: c.id },
        data: {
          estado: 1,
          fechaCierreReal: deInputDate(String(c.fecha_cierre_real ?? "")) ?? fechaCaptura,
          reunionCierreId: id,
          cerradoPorNombre: user.name,
          observacion: previo.observacion?.trim()
            ? `${previo.observacion.trim()}\n${comoSeCerro}`
            : comoSeCerro,
        },
      });
    }

    for (const r of p.reprogramaciones ?? []) {
      const fechaNueva = deInputDate(String(r.fecha_nueva ?? ""));
      if (!r.id || !fechaNueva) continue;
      const actual = await tx.compromiso.findUnique({
        where: { id: r.id },
        select: { fechaCierre: true, fecha2doCompromiso: true },
      });
      if (!actual) continue;
      await tx.compromisoReprogramacion.create({
        data: {
          compromisoId: r.id,
          fechaAnterior: actual.fecha2doCompromiso ?? actual.fechaCierre,
          fechaNueva, motivo: r.motivo || null,
          reunionId: id, creadoPorNombre: user.name,
        },
      });
      await tx.compromiso.update({
        where: { id: r.id }, data: { fecha2doCompromiso: fechaNueva },
      });
    }

    await tx.reunion.update({
      where: { id },
      data: { estado: "publicada", publicadaPorNombre: user.name, publicadaEn: new Date() },
    });
  });

  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "MINUTA_PUBLICAR", entityType: "reunion", entityId: id,
    summary: `Publicó la minuta con ${(p.compromisos_nuevos?.length ?? 0) - omitidos} compromisos nuevos y ${p.cierres?.length ?? 0} cierres${omitidos > 0 ? ` (${omitidos} omitidos por estar ya abiertos)` : ""}`,
  }).catch(() => {});

  revalidatePath("/compromisos");
  revalidatePath("/reuniones");
  redirect(`/reuniones/${id}/minuta?status=publicada${omitidos > 0 ? `&omitidos=${omitidos}` : ""}`);
}
