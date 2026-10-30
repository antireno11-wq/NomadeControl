"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRequerimientos } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { deInputDate } from "@/lib/ddd";
import { formatDisplayDate } from "@/lib/report-utils";
import { formatearRut, limpiarNombre, normalizarRut, rutValido } from "@/lib/acreditacion";
import {
  APROBABLE_DESDE, ESTADOS_ABIERTOS, REQUIEREN_APROBACION, TURNOS,
  codigoReq, esEstadoPostulante, estaAbierta, estaTerminada, estadoCalculado,
  etiquetaPostulante, etiquetaSolicitud, postulanteEnProceso, vacantesCubiertas,
  type EstadoSolicitud,
} from "@/lib/requerimientos";
import { avisar, registrarEvento, sincronizarEstado, textoCambio } from "@/lib/requerimientos-db";

const MAX_CV = 10 * 1024 * 1024;

/** Turnos que entiende la ficha del trabajador. Otro valor rompería su formulario. */
const TURNO_FICHA: Record<string, { work: number; off: number }> = {
  "14x14": { work: 14, off: 14 },
  "10x10": { work: 10, off: 10 },
  "7x7": { work: 7, off: 7 },
  "4x3": { work: 4, off: 3 },
};

function texto(formData: FormData, campo: string): string {
  return String(formData.get(campo) ?? "").trim();
}

function volver(id: string, status: string): never {
  revalidatePath("/requerimientos");
  revalidatePath(`/requerimientos/${id}`);
  redirect(`/requerimientos/${id}?status=${status}`);
}

function hoyUTC(): Date {
  const h = new Date();
  return new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), h.getUTCDate(), 12));
}

/**
 * Carga la solicitud y decide quién es quien la toca.
 *
 * El solicitante solo llega a las suyas. Ocultarlas en el tablero no basta:
 * las acciones también se pueden llamar con el id de otra.
 */
async function conAcceso(id: string) {
  const acceso = await requireRequerimientos();
  const req = id ? await db.requerimiento.findUnique({
    where: { id },
    select: {
      id: true, numero: true, estado: true, solicitanteId: true, vacantes: true,
      fechaRequerida: true, cargoId: true, proyectoId: true, turno: true,
      cargo: { select: { nombre: true } },
      proyecto: { select: { nombre: true } },
    },
  }) : null;
  if (!req) redirect("/requerimientos?status=no-encontrada");
  const esSolicitante = req.solicitanteId === acceso.user.id;
  if (!acceso.gestiona && !esSolicitante) redirect("/requerimientos?status=ajena");
  return { ...acceso, req, esSolicitante };
}

/** Lee y valida los campos de la solicitud, comunes a crear y editar. */
async function leerSolicitud(formData: FormData) {
  const cargoId = texto(formData, "cargoId");
  const proyectoId = texto(formData, "proyectoId");
  const vacantes = Number.parseInt(texto(formData, "vacantes"), 10);
  const fechaRequerida = deInputDate(texto(formData, "fechaRequerida"));
  const turnoSel = texto(formData, "turno");
  const turno = turnoSel === "otro" ? texto(formData, "turnoOtro") : turnoSel;
  const prioridad = texto(formData, "prioridad");

  if (!cargoId || !proyectoId || !fechaRequerida || !turno) return { error: "invalida" as const };
  if (!Number.isFinite(vacantes) || vacantes < 1 || vacantes > 100) return { error: "invalida" as const };
  if (!["alta", "media", "baja"].includes(prioridad)) return { error: "invalida" as const };

  const [cargo, proyecto] = await Promise.all([
    db.cargo.findFirst({ where: { id: cargoId, activo: true }, select: { nombre: true } }),
    db.proyecto.findFirst({ where: { id: proyectoId, activo: true }, select: { nombre: true } }),
  ]);
  if (!cargo || !proyecto) return { error: "invalida" as const };

  return {
    error: null,
    datos: {
      cargoId, proyectoId, vacantes, fechaRequerida, turno: turno.slice(0, 40), prioridad,
      requisitos: texto(formData, "requisitos") || null,
      observaciones: texto(formData, "observaciones") || null,
    },
    cargo: cargo.nombre, proyecto: proyecto.nombre,
  };
}

// ─── Solicitud ───────────────────────────────────────────────────────────────

export async function crearRequerimientoAction(formData: FormData) {
  const { user } = await requireRequerimientos();
  const leido = await leerSolicitud(formData);
  if (leido.error) redirect(`/requerimientos/nueva?status=${leido.error}`);
  const { datos, cargo, proyecto } = leido;

  // Una fecha que ya pasó nace en rojo y sin plazo posible: casi siempre es
  // un error al elegir el año.
  if (datos.fechaRequerida < hoyUTC()) redirect("/requerimientos/nueva?status=fecha-pasada");

  const creado = await db.requerimiento.create({
    data: { ...datos, solicitanteId: user.id, solicitanteNombre: user.name },
    select: { id: true, numero: true },
  });
  await registrarEvento({
    requerimientoId: creado.id, tipo: "creacion", estadoNuevo: "solicitado",
    autorId: user.id, autorNombre: user.name,
    detalle: `${datos.vacantes} × ${cargo} para ${proyecto}`,
  });
  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "REQUERIMIENTO_CREATE", entityType: "requerimiento", entityId: creado.id,
    summary: `Pidió ${datos.vacantes} ${cargo} para ${proyecto} (${codigoReq(creado.numero)})`,
  }).catch(() => {});

  await avisar(creado.id, "rrhh", [
    `${user.name} pidió ${datos.vacantes} ${datos.vacantes === 1 ? "persona" : "personas"} para ${cargo} en ${proyecto}, con ingreso el ${formatDisplayDate(datos.fechaRequerida)}.`,
  ], user.id);

  volver(creado.id, "creada");
}

/**
 * Edita los campos. Gerencia siempre; el solicitante mientras RRHH no haya
 * empezado. Después, cambiar el cargo o las vacantes por su cuenta le movería
 * el piso a una búsqueda en curso.
 */
export async function editarRequerimientoAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const { user, gerencia, esSolicitante, req } = await conAcceso(id);
  if (!gerencia && !(esSolicitante && req.estado === "solicitado")) volver(id, "sin-permiso");

  const leido = await leerSolicitud(formData);
  if (leido.error) volver(id, leido.error);
  const { datos, cargo, proyecto } = leido;

  const antes = await db.requerimiento.findUnique({
    where: { id },
    select: { vacantes: true, fechaRequerida: true, turno: true, prioridad: true, requisitos: true, observaciones: true },
  });
  if (!antes) volver(id, "no-encontrada");

  const cambios = [
    req.cargoId !== datos.cargoId ? `Cargo: ${req.cargo.nombre} → ${cargo}` : null,
    req.proyectoId !== datos.proyectoId ? `Proyecto: ${req.proyecto.nombre} → ${proyecto}` : null,
    antes.vacantes !== datos.vacantes ? `Vacantes: ${antes.vacantes} → ${datos.vacantes}` : null,
    antes.fechaRequerida.getTime() !== datos.fechaRequerida.getTime()
      ? `Fecha requerida: ${formatDisplayDate(antes.fechaRequerida)} → ${formatDisplayDate(datos.fechaRequerida)}` : null,
    antes.turno !== datos.turno ? `Turno: ${antes.turno} → ${datos.turno}` : null,
    antes.prioridad !== datos.prioridad ? `Prioridad: ${antes.prioridad} → ${datos.prioridad}` : null,
    (antes.requisitos ?? "") !== (datos.requisitos ?? "") ? "Requisitos actualizados" : null,
    (antes.observaciones ?? "") !== (datos.observaciones ?? "") ? "Observaciones actualizadas" : null,
  ].filter((c): c is string => Boolean(c));
  if (cambios.length === 0) volver(id, "sin-cambios");

  await db.requerimiento.update({ where: { id }, data: datos });
  await registrarEvento({
    requerimientoId: id, tipo: "edicion", autorId: user.id, autorNombre: user.name,
    detalle: cambios.join(" · "),
  });
  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "REQUERIMIENTO_EDITAR", entityType: "requerimiento", entityId: id,
    summary: `Editó ${codigoReq(req.numero)} — ${cambios.join(" · ")}`,
  }).catch(() => {});

  // Cambiar las vacantes puede cubrir la solicitud o dejarla con un puesto libre.
  const cambio = antes.vacantes !== datos.vacantes ? await sincronizarEstado(id) : null;

  await avisar(id, esSolicitante ? "rrhh" : "solicitante", [
    `${user.name} editó la solicitud: ${cambios.join(" · ")}.`,
    ...(cambio ? [textoCambio(cambio)] : []),
  ], user.id);

  volver(id, "editada");
}

/** Mueve la solicitud entre los estados abiertos. Solo RRHH y gerencia. */
export async function cambiarEstadoRequerimientoAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const nuevo = texto(formData, "estado") as EstadoSolicitud;
  const { user, gestiona, req } = await conAcceso(id);
  if (!gestiona) volver(id, "sin-permiso");
  // Contratado lo decide el conteo de vacantes y Cerrado/Desistido tienen su
  // propio paso con motivo: por acá solo se mueve entre los abiertos.
  if (!ESTADOS_ABIERTOS.includes(nuevo) || !estaAbierta(req.estado)) volver(id, "estado-invalido");
  if (nuevo === req.estado) volver(id, "sin-cambios");

  await db.requerimiento.update({ where: { id }, data: { estado: nuevo } });
  await registrarEvento({
    requerimientoId: id, tipo: "estado", estadoAnterior: req.estado, estadoNuevo: nuevo,
    autorId: user.id, autorNombre: user.name,
  });
  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "REQUERIMIENTO_ESTADO", entityType: "requerimiento", entityId: id,
    summary: `${codigoReq(req.numero)}: ${etiquetaSolicitud(req.estado)} → ${etiquetaSolicitud(nuevo)}`,
  }).catch(() => {});

  await avisar(id, "solicitante", [`${user.name} cambió el estado. ${textoCambio({ anterior: req.estado, nuevo })}`], user.id);
  volver(id, "estado-cambiado");
}

/**
 * Cierra o desiste.
 *
 * Con postulantes todavía en proceso no se cierra a ciegas: hay que
 * confirmar que se descartan, y quedan descartados con el motivo. Si no, la
 * solicitud se cierra y esas personas siguen "en exámenes" para siempre,
 * esperando una respuesta que nadie les va a dar.
 */
export async function cerrarRequerimientoAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const accion = texto(formData, "accion");
  const motivo = texto(formData, "motivo");
  const { user, gestiona, esSolicitante, req } = await conAcceso(id);

  if (accion !== "cerrar" && accion !== "desistir") volver(id, "estado-invalido");
  if (estaTerminada(req.estado)) volver(id, "estado-invalido");
  if (accion === "cerrar" && !gestiona) volver(id, "sin-permiso");
  if (accion === "desistir" && !gestiona && !esSolicitante) volver(id, "sin-permiso");

  const postulantes = await db.postulante.findMany({
    where: { requerimientoId: id }, select: { id: true, nombre: true, estado: true },
  });
  const incompleta = vacantesCubiertas(postulantes) < req.vacantes;
  if (motivo.length < 4 && (accion === "desistir" || incompleta)) volver(id, "sin-motivo");

  const pendientes = postulantes.filter(p => postulanteEnProceso(p.estado));
  if (pendientes.length > 0 && formData.get("confirmarDescarte") !== "on") volver(id, "pendientes");

  const nuevo: EstadoSolicitud = accion === "cerrar" ? "cerrado" : "desistido";
  const motivoDescarte = accion === "cerrar"
    ? (motivo ? `Solicitud cerrada: ${motivo}` : "Vacantes cubiertas")
    : `Solicitud desistida: ${motivo}`;

  for (const p of pendientes) {
    await db.postulante.update({ where: { id: p.id }, data: { estado: "descartado", motivoDescarte } });
    await registrarEvento({
      requerimientoId: id, postulanteId: p.id, tipo: "estado",
      estadoAnterior: p.estado, estadoNuevo: "descartado",
      autorId: user.id, autorNombre: user.name, detalle: `${p.nombre}: ${motivoDescarte}`,
    });
  }

  await db.requerimiento.update({
    where: { id },
    data: { estado: nuevo, motivoCierre: motivo || null, cerradoEn: new Date() },
  });
  await registrarEvento({
    requerimientoId: id, tipo: "estado", estadoAnterior: req.estado, estadoNuevo: nuevo,
    autorId: user.id, autorNombre: user.name, detalle: motivo || null,
  });
  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: accion === "cerrar" ? "REQUERIMIENTO_CERRAR" : "REQUERIMIENTO_DESISTIR",
    entityType: "requerimiento", entityId: id,
    summary: `${accion === "cerrar" ? "Cerró" : "Desistió de"} ${codigoReq(req.numero)}${motivo ? `: ${motivo}` : ""}`,
  }).catch(() => {});

  await avisar(id, esSolicitante ? "rrhh" : "solicitante", [
    `${user.name} ${accion === "cerrar" ? "cerró" : "desistió de"} la solicitud${motivo ? `: «${motivo}»` : "."}`,
    ...(pendientes.length > 0 ? [`Se descartó a ${pendientes.length} postulante${pendientes.length === 1 ? "" : "s"} que seguía${pendientes.length === 1 ? "" : "n"} en proceso.`] : []),
  ], user.id);

  volver(id, accion === "cerrar" ? "cerrada" : "desistida");
}

/** Reabre una solicitud cerrada o desistida por error. Solo gerencia. */
export async function reabrirRequerimientoAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const { user, gerencia, req } = await conAcceso(id);
  if (!gerencia) volver(id, "sin-permiso");
  if (!estaTerminada(req.estado)) volver(id, "estado-invalido");

  const postulantes = await db.postulante.findMany({ where: { requerimientoId: id }, select: { estado: true } });
  const nuevo = estadoCalculado("solicitado", req.vacantes, postulantes) ?? "solicitado";

  await db.requerimiento.update({
    where: { id },
    data: {
      estado: nuevo, cerradoEn: null, motivoCierre: null,
      contratadoEn: nuevo === "contratado" ? new Date() : null,
    },
  });
  await registrarEvento({
    requerimientoId: id, tipo: "estado", estadoAnterior: req.estado, estadoNuevo: nuevo,
    autorId: user.id, autorNombre: user.name, detalle: "Reabierta",
  });
  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: "REQUERIMIENTO_REABRIR", entityType: "requerimiento", entityId: id,
    summary: `Reabrió ${codigoReq(req.numero)}`,
  }).catch(() => {});

  await avisar(id, "solicitante", [`${user.name} reabrió la solicitud. ${textoCambio({ anterior: req.estado, nuevo })}`], user.id);
  volver(id, "reabierta");
}

// ─── Postulantes ─────────────────────────────────────────────────────────────

/**
 * RUT en la forma única de la aplicación.
 *
 * Mismo criterio que la ficha del trabajador: si tiene forma de RUT se valida
 * por módulo 11 y se rechaza mal tecleado; si no (pasaporte de un
 * extranjero), se guarda tal cual. Rechazar a un extranjero porque no pasa
 * un cálculo chileno sería impedir contratarlo.
 */
function limpiarRut(crudo: string): { rut: string; invalido: boolean } {
  const limpio = normalizarRut(crudo);
  const pareceRut = /^\d{7,9}[0-9K]$/.test(limpio);
  if (pareceRut && !rutValido(limpio)) return { rut: crudo, invalido: true };
  return { rut: pareceRut ? formatearRut(limpio) : crudo.trim(), invalido: false };
}

/** Guarda el CV. Valida antes de escribir: un postulante guardado sin el CV
 *  que el usuario creyó adjuntar es peor que un error. */
async function leerCv(formData: FormData): Promise<{ archivo: File | null; error: string | null }> {
  const archivo = formData.get("cv");
  if (!(archivo instanceof File) || archivo.size === 0) return { archivo: null, error: null };
  if (archivo.size > MAX_CV) return { archivo: null, error: "cv-grande" };
  const esPdf = archivo.type === "application/pdf" || archivo.name.toLowerCase().endsWith(".pdf");
  if (!esPdf) return { archivo: null, error: "cv-no-pdf" };
  return { archivo, error: null };
}

async function guardarCv(archivo: File, autor: string): Promise<string> {
  const creado = await db.archivoAcreditacion.create({
    data: {
      contenido: Buffer.from(await archivo.arrayBuffer()),
      originalFilename: archivo.name || "cv.pdf",
      mimeType: "application/pdf",
      fileSize: archivo.size,
      subidoPorNombre: autor,
    },
    select: { id: true },
  });
  return creado.id;
}

export async function agregarPostulanteAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const { user, gestiona, req } = await conAcceso(id);
  if (!gestiona) volver(id, "sin-permiso");
  if (!estaAbierta(req.estado)) volver(id, "no-abierta");

  const nombre = limpiarNombre(texto(formData, "nombre"));
  const { rut, invalido } = limpiarRut(texto(formData, "rut"));
  if (nombre.length < 3 || !rut) volver(id, "postulante-invalido");
  if (invalido) volver(id, "rut-invalido");

  const repetido = await db.postulante.findUnique({
    where: { requerimientoId_rut: { requerimientoId: id, rut } }, select: { id: true },
  });
  if (repetido) volver(id, "rut-repetido");

  const cv = await leerCv(formData);
  if (cv.error) volver(id, cv.error);
  const cvArchivoId = cv.archivo ? await guardarCv(cv.archivo, user.name) : null;

  const postulante = await db.postulante.create({
    data: {
      requerimientoId: id, nombre, rut,
      telefono: texto(formData, "telefono") || null,
      email: texto(formData, "email").toLowerCase() || null,
      fechaPostulacion: deInputDate(texto(formData, "fechaPostulacion")) ?? new Date(),
      cvArchivoId, cargadoPorNombre: user.name,
    },
    select: { id: true },
  });
  await registrarEvento({
    requerimientoId: id, postulanteId: postulante.id, tipo: "postulante",
    estadoNuevo: "postulado", autorId: user.id, autorNombre: user.name,
    detalle: `Cargó a ${nombre}${cvArchivoId ? " con CV" : " sin CV"}`,
  });

  const cambio = await sincronizarEstado(id);
  await avisar(id, "solicitante", [
    `${user.name} cargó a ${nombre} como postulante.`,
    ...(cambio ? [textoCambio(cambio)] : []),
  ], user.id);

  volver(id, "postulante-agregado");
}

/** Corrige los datos del postulante o reemplaza su CV. Solo RRHH y gerencia. */
export async function editarPostulanteAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const postulanteId = texto(formData, "postulanteId");
  const { user, gestiona } = await conAcceso(id);
  if (!gestiona) volver(id, "sin-permiso");

  const antes = await db.postulante.findFirst({
    where: { id: postulanteId, requerimientoId: id },
    select: { nombre: true, rut: true, telefono: true, email: true, fechaPostulacion: true },
  });
  if (!antes) volver(id, "no-encontrada");

  const nombre = limpiarNombre(texto(formData, "nombre"));
  const { rut, invalido } = limpiarRut(texto(formData, "rut"));
  if (nombre.length < 3 || !rut) volver(id, "postulante-invalido");
  if (invalido) volver(id, "rut-invalido");
  if (rut !== antes.rut) {
    const repetido = await db.postulante.findUnique({
      where: { requerimientoId_rut: { requerimientoId: id, rut } }, select: { id: true },
    });
    if (repetido) volver(id, "rut-repetido");
  }

  const cv = await leerCv(formData);
  if (cv.error) volver(id, cv.error);

  const telefono = texto(formData, "telefono") || null;
  const email = texto(formData, "email").toLowerCase() || null;
  const fechaPostulacion = deInputDate(texto(formData, "fechaPostulacion")) ?? antes.fechaPostulacion;

  const cambios = [
    antes.nombre !== nombre ? `Nombre: ${antes.nombre} → ${nombre}` : null,
    antes.rut !== rut ? `RUT: ${antes.rut} → ${rut}` : null,
    (antes.telefono ?? "") !== (telefono ?? "") ? "Teléfono actualizado" : null,
    (antes.email ?? "") !== (email ?? "") ? "Correo actualizado" : null,
    antes.fechaPostulacion.getTime() !== fechaPostulacion.getTime()
      ? `Fecha de postulación: ${formatDisplayDate(antes.fechaPostulacion)} → ${formatDisplayDate(fechaPostulacion)}` : null,
  ].filter((c): c is string => Boolean(c));
  if (cambios.length === 0 && !cv.archivo) volver(id, "sin-cambios");

  const cvArchivoId = cv.archivo ? await guardarCv(cv.archivo, user.name) : undefined;
  await db.postulante.update({
    where: { id: postulanteId },
    data: { nombre, rut, telefono, email, fechaPostulacion, ...(cvArchivoId ? { cvArchivoId } : {}) },
  });

  if (cambios.length > 0) {
    await registrarEvento({
      requerimientoId: id, postulanteId, tipo: "edicion", autorId: user.id, autorNombre: user.name,
      detalle: `${nombre}: ${cambios.join(" · ")}`,
    });
  }
  if (cvArchivoId) {
    // El CV anterior no se borra: queda el archivo, y el historial dice cuándo cambió.
    await registrarEvento({
      requerimientoId: id, postulanteId, tipo: "cv", autorId: user.id, autorNombre: user.name,
      detalle: `${nombre}: CV ${cv.archivo?.name ? `reemplazado por «${cv.archivo.name}»` : "reemplazado"}`,
    });
  }
  volver(id, "postulante-editado");
}

/**
 * Mueve a un postulante. Solo RRHH y gerencia.
 *
 * "Aprobado por solicitante" no se marca por acá: es la decisión de quien
 * pidió el cargo. Y a exámenes o a contrato solo se llega con esa aprobación.
 */
export async function cambiarEstadoPostulanteAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const postulanteId = texto(formData, "postulanteId");
  const nuevo = texto(formData, "estado");
  const motivo = texto(formData, "motivo");
  const { user, gestiona, req } = await conAcceso(id);
  if (!gestiona) volver(id, "sin-permiso");
  if (estaTerminada(req.estado)) volver(id, "no-abierta");
  if (!esEstadoPostulante(nuevo) || nuevo === "aprobado") volver(id, "estado-invalido");

  const p = await db.postulante.findFirst({
    where: { id: postulanteId, requerimientoId: id },
    select: { nombre: true, estado: true, aprobadoEn: true },
  });
  if (!p) volver(id, "no-encontrada");
  if (p.estado === nuevo) volver(id, "sin-cambios");
  if (REQUIEREN_APROBACION.includes(nuevo) && !p.aprobadoEn) volver(id, "sin-aprobacion");
  if (nuevo === "descartado" && motivo.length < 4) volver(id, "sin-motivo");

  await db.postulante.update({
    where: { id: postulanteId },
    data: {
      estado: nuevo,
      motivoDescarte: nuevo === "descartado" ? motivo : null,
      contratadoEn: nuevo === "contratado" ? new Date() : null,
    },
  });
  await registrarEvento({
    requerimientoId: id, postulanteId, tipo: "estado", estadoAnterior: p.estado, estadoNuevo: nuevo,
    autorId: user.id, autorNombre: user.name,
    detalle: nuevo === "descartado" ? `${p.nombre}: ${motivo}` : p.nombre,
  });

  const cambio = await sincronizarEstado(id);

  // Al solicitante le importa lo que le pide algo (aprobar) o lo que cierra
  // su búsqueda (contratado). Avisarle cada paso intermedio entrena a no
  // leer los correos.
  const novedades = [
    ...(APROBABLE_DESDE.includes(nuevo) ? [`${p.nombre} pasó a «${etiquetaPostulante(nuevo)}» y espera tu aprobación.`] : []),
    ...(nuevo === "contratado" ? [`${p.nombre} fue contratado.`] : []),
    ...(cambio ? [textoCambio(cambio)] : []),
  ];
  await avisar(id, "solicitante", novedades, user.id);

  volver(id, "postulante-movido");
}

/** El solicitante (o gerencia) aprueba o rechaza a un candidato propuesto. */
export async function decidirPostulanteAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const postulanteId = texto(formData, "postulanteId");
  const decision = texto(formData, "decision");
  const motivo = texto(formData, "motivo");
  const { user, gerencia, esSolicitante, req } = await conAcceso(id);
  if (!gerencia && !esSolicitante) volver(id, "sin-permiso");
  if (!estaAbierta(req.estado) && req.estado !== "contratado") volver(id, "no-abierta");
  if (decision !== "aprobar" && decision !== "rechazar") volver(id, "estado-invalido");

  const p = await db.postulante.findFirst({
    where: { id: postulanteId, requerimientoId: id }, select: { nombre: true, estado: true },
  });
  if (!p) volver(id, "no-encontrada");
  if (!(APROBABLE_DESDE as string[]).includes(p.estado)) volver(id, "no-aprobable");
  if (decision === "rechazar" && motivo.length < 4) volver(id, "sin-motivo");

  const aprobar = decision === "aprobar";
  await db.postulante.update({
    where: { id: postulanteId },
    data: aprobar
      ? { estado: "aprobado", aprobadoEn: new Date(), aprobadoPorNombre: user.name }
      : { estado: "descartado", motivoDescarte: `Rechazado por ${user.name}: ${motivo}` },
  });
  await registrarEvento({
    requerimientoId: id, postulanteId, tipo: "estado",
    estadoAnterior: p.estado, estadoNuevo: aprobar ? "aprobado" : "descartado",
    autorId: user.id, autorNombre: user.name,
    detalle: aprobar ? `Aprobó a ${p.nombre}${motivo ? `: ${motivo}` : ""}` : `Rechazó a ${p.nombre}: ${motivo}`,
  });
  if (motivo && aprobar) {
    await db.requerimientoComentario.create({
      data: { requerimientoId: id, postulanteId, texto: motivo, autorId: user.id, autorNombre: user.name },
    });
  }

  const cambio = await sincronizarEstado(id);
  await avisar(id, "rrhh", [
    aprobar ? `${user.name} aprobó a ${p.nombre}${motivo ? `: «${motivo}»` : "."}` : `${user.name} rechazó a ${p.nombre}: «${motivo}».`,
    ...(cambio ? [textoCambio(cambio)] : []),
  ], user.id);

  volver(id, aprobar ? "aprobado" : "rechazado");
}

// ─── Comentarios ─────────────────────────────────────────────────────────────

export async function comentarAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const postulanteId = texto(formData, "postulanteId") || null;
  const cuerpo = texto(formData, "texto");
  const { user, esSolicitante } = await conAcceso(id);
  if (cuerpo.length < 2) volver(id, "comentario-vacio");

  let sobre: string | null = null;
  if (postulanteId) {
    const p = await db.postulante.findFirst({ where: { id: postulanteId, requerimientoId: id }, select: { nombre: true } });
    if (!p) volver(id, "no-encontrada");
    sobre = p.nombre;
  }

  await db.requerimientoComentario.create({
    data: { requerimientoId: id, postulanteId, texto: cuerpo.slice(0, 4000), autorId: user.id, autorNombre: user.name },
  });

  // A la otra parte: lo que escribe el solicitante le llega a RRHH, y al revés.
  await avisar(id, esSolicitante ? "rrhh" : "solicitante", [
    `${user.name} comentó${sobre ? ` sobre ${sobre}` : ""}: «${cuerpo.slice(0, 500)}»`,
  ], user.id);

  volver(id, "comentado");
}

// ─── Ficha de trabajador ─────────────────────────────────────────────────────

/**
 * Pasa al contratado a Trabajadores, con lo que ya se sabe de él.
 *
 * Antes de crear, busca por RUT. Si ya tiene ficha activa, solo se vincula:
 * crear otra es como nacen los trabajadores duplicados. Si la tiene de baja,
 * se reactiva con el cargo y el proyecto nuevos: volver a contratarlo es la
 * señal más clara de que volvió.
 */
export async function crearFichaTrabajadorAction(formData: FormData) {
  const id = texto(formData, "requerimientoId");
  const postulanteId = texto(formData, "postulanteId");
  const { user, gestiona, req } = await conAcceso(id);
  if (!gestiona) volver(id, "sin-permiso");

  const p = await db.postulante.findFirst({
    where: { id: postulanteId, requerimientoId: id },
    select: { nombre: true, rut: true, telefono: true, email: true, estado: true, staffMemberId: true },
  });
  if (!p) volver(id, "no-encontrada");
  if (p.estado !== "contratado") volver(id, "no-contratado");
  if (p.staffMemberId) redirect(`/trabajadores/${p.staffMemberId}`);

  const clave = normalizarRut(p.rut);
  const conRut = await db.staffMember.findMany({
    where: { nationalId: { not: null } },
    select: { id: true, nationalId: true, isActive: true, phone: true, personalEmail: true },
  });
  const existente = conRut.find(s => normalizarRut(s.nationalId) === clave) ?? null;

  let staffMemberId: string;
  let resultado: "ficha-vinculada" | "ficha-reactivada" | "ficha-creada";

  if (existente?.isActive) {
    staffMemberId = existente.id;
    resultado = "ficha-vinculada";
  } else if (existente) {
    await db.staffMember.update({
      where: { id: existente.id },
      data: {
        isActive: true, motivoBaja: null, fechaBaja: null,
        cargoId: req.cargoId, proyectoId: req.proyectoId,
        phone: existente.phone ?? p.telefono, personalEmail: existente.personalEmail ?? p.email,
      },
    });
    staffMemberId = existente.id;
    resultado = "ficha-reactivada";
  } else {
    const turno = TURNO_FICHA[req.turno] ? req.turno : "14x14";
    const creado = await db.staffMember.create({
      data: {
        fullName: p.nombre, nationalId: p.rut, phone: p.telefono, personalEmail: p.email,
        role: req.cargo.nombre, cargoId: req.cargoId, proyectoId: req.proyectoId,
        shiftPattern: turno, shiftWorkDays: TURNO_FICHA[turno].work, shiftOffDays: TURNO_FICHA[turno].off,
        shiftStartDate: req.fechaRequerida, createdById: user.id, isActive: true,
        notes: `Contratado por ${codigoReq(req.numero)} (Requerimientos de personal).`
          + (turno !== req.turno ? ` Turno pedido: ${req.turno}.` : ""),
      },
      select: { id: true },
    });
    staffMemberId = creado.id;
    resultado = "ficha-creada";
  }

  if (resultado !== "ficha-vinculada") {
    // La acreditación también va a la tabla de faenas; sin esto queda fuera
    // del modelo de dos proyectos (mismo criterio que la carga con IA).
    await db.trabajadorProyecto.upsert({
      where: { staffMemberId_proyectoId: { staffMemberId, proyectoId: req.proyectoId } },
      update: { hasta: null },
      create: { staffMemberId, proyectoId: req.proyectoId },
    }).catch(() => {});
  }

  await db.postulante.update({ where: { id: postulanteId }, data: { staffMemberId } });
  await registrarEvento({
    requerimientoId: id, postulanteId, tipo: "ficha", autorId: user.id, autorNombre: user.name,
    detalle: resultado === "ficha-creada" ? `Creó la ficha de trabajador de ${p.nombre}`
      : resultado === "ficha-reactivada" ? `Reactivó la ficha de trabajador de ${p.nombre}`
      : `Vinculó a ${p.nombre} con su ficha de trabajador existente`,
  });
  await logAuditEvent({
    actorUserId: user.id, actorName: user.name, actorEmail: user.email,
    action: resultado === "ficha-creada" ? "CREATE_WORKER" : "REQUERIMIENTO_FICHA",
    entityType: "staffMember", entityId: staffMemberId,
    summary: `${resultado === "ficha-creada" ? "Creó" : resultado === "ficha-reactivada" ? "Reactivó" : "Vinculó"} la ficha de ${p.nombre} desde ${codigoReq(req.numero)}`,
  }).catch(() => {});

  revalidatePath("/trabajadores");
  revalidatePath("/trabajadores/control-documental");
  volver(id, resultado);
}
