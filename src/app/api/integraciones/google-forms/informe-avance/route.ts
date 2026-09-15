import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Recibe el "Informe Diario de Avance" desde Google Forms.
 *
 * Mismo mecanismo que el checklist: el script del formulario hace un POST
 * por envío con el secreto compartido, y acá se guarda. El proyecto se
 * resuelve por el nombre que viene en el formulario; si no calza con
 * ninguno, el informe se guarda igual con el texto —un informe sin proyecto
 * es mejor que un informe perdido, y se ve en la lista para corregirlo.
 */

type Payload = {
  responseId: string;
  timestamp?: string;
  email?: string;
  respuestas: Record<string, string | string[]>;
  archivos?: Record<string, string[]>;
};

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function buscar(resp: Record<string, string | string[]>, ...fragmentos: string[]): string {
  for (const [pregunta, valor] of Object.entries(resp)) {
    const p = sinTildes(pregunta);
    if (fragmentos.every(f => p.includes(sinTildes(f)))) {
      return Array.isArray(valor) ? valor.join(", ") : String(valor ?? "");
    }
  }
  return "";
}

function archivosDe(archivos: Record<string, string[]> | undefined, ...fragmentos: string[]): string[] {
  for (const [pregunta, urls] of Object.entries(archivos ?? {})) {
    const p = sinTildes(pregunta);
    if (fragmentos.every(f => p.includes(sinTildes(f)))) {
      return (urls ?? []).filter(u => typeof u === "string" && u.startsWith("http"));
    }
  }
  return [];
}

export async function POST(req: NextRequest) {
  const secreto = process.env.GOOGLE_FORMS_WEBHOOK_SECRET;
  if (!secreto) return NextResponse.json({ error: "Integración no configurada" }, { status: 503 });
  if (req.headers.get("x-webhook-secret") !== secreto) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Payload;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body?.responseId || !body.respuestas) {
    return NextResponse.json({ error: "Faltan responseId o respuestas" }, { status: 400 });
  }

  const yaExiste = await db.informeAvance.findUnique({
    where: { formularioRespuestaId: body.responseId }, select: { id: true },
  });
  if (yaExiste) return NextResponse.json({ ok: true, informeId: yaExiste.id, duplicado: true });

  const r = body.respuestas;
  const proyectoTexto = buscar(r, "proyecto").trim();
  const actividades = buscar(r, "actividades").trim();
  const responsable = buscar(r, "responsable").trim();
  if (!actividades || !responsable) {
    return NextResponse.json({ error: "Faltan actividades o responsable" }, { status: 422 });
  }

  // "Agua Verde (Anglo American)" → proyecto cuyo nombre o mandante aparezca
  // en el texto. Se compara sin tildes y sin distinguir mayúsculas.
  const proyectos = await db.proyecto.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, faena: true, mandante: { select: { nombre: true } } },
  });
  const texto = sinTildes(proyectoTexto);
  const proyecto = proyectos.find(p =>
    texto.includes(sinTildes(p.nombre)) ||
    (p.faena && texto.includes(sinTildes(p.faena))) ||
    (p.mandante?.nombre && texto.includes(sinTildes(p.mandante.nombre))),
  ) ?? null;

  const fechaTxt = buscar(r, "fecha del informe");
  const fecha = fechaTxt && !Number.isNaN(Date.parse(fechaTxt)) ? new Date(fechaTxt)
    : body.timestamp && !Number.isNaN(Date.parse(body.timestamp)) ? new Date(body.timestamp)
    : new Date();

  const dotRaw = buscar(r, "dotacion total").replace(/[^\d]/g, "");
  const hallazgos = buscar(r, "problemas o hallazgos").trim();

  const informe = await db.informeAvance.create({
    data: {
      proyectoId: proyecto?.id ?? null,
      proyectoTexto: proyectoTexto || "Sin indicar",
      fecha,
      responsable,
      email: (body.email || "").trim().toLowerCase() || null,
      dotacionTotal: dotRaw ? Number(dotRaw) : null,
      dotacionDetalle: buscar(r, "detalle de dotacion").trim() || null,
      horaIngreso: buscar(r, "horario de ingreso").trim() || null,
      horaTermino: buscar(r, "horario de termino").trim() || null,
      actividades,
      // "Sin hallazgos" es una respuesta válida, no un hallazgo: se guarda
      // como vacío para que la lista no lo marque.
      hallazgos: hallazgos && !/^sin hallazgos?\.?$/i.test(hallazgos) ? hallazgos : null,
      observaciones: buscar(r, "observaciones").trim() || null,
      fotosDocumentacion: archivosDe(body.archivos, "documentacion"),
      fotosAvance: archivosDe(body.archivos, "avance"),
      formularioRespuestaId: body.responseId,
      respuestas: r as never,
    },
    select: { id: true },
  });

  return NextResponse.json({
    ok: true, informeId: informe.id,
    proyecto: proyecto?.nombre ?? null,
    aviso: proyecto ? undefined : `No se reconoció el proyecto «${proyectoTexto}»: el informe quedó guardado sin proyecto`,
  });
}
