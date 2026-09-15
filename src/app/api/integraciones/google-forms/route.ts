import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { plantillaPara, evaluarChecklist, evaluarRespuestasSGI, ITEMS_COMUNES, type NeumaticoMedido } from "@/lib/checklist-vehiculos";

/**
 * Recibe una respuesta del formulario SGI-F-GE-024 (Google Forms) y la
 * registra como checklist del vehículo.
 *
 * El formulario es el canal de entrada; las reglas viven acá. Un script de
 * Apps Script instalado en el formulario hace un POST por cada envío, con un
 * secreto compartido en la cabecera. No se lee la hoja de respuestas ni se
 * consulta nada de Google: llega el dato, se guarda.
 *
 * No depende de conocer las preguntas: se guardan TODAS en `respuestas`, y el
 * veredicto sale de la convención que ya usa el SGI —C / NC / NA, con ★ en
 * los críticos—. Si el formulario cambia de revisión, esto sigue funcionando.
 */

type Payload = {
  responseId: string;
  timestamp?: string;
  email?: string;
  /** Pregunta → respuesta (texto, o lista de textos para casillas múltiples). */
  respuestas: Record<string, string | string[]>;
  /** URLs de Drive de los archivos subidos, por pregunta. */
  archivos?: Record<string, string[]>;
};

const normPatente = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normRut = (s: string) => s.toUpperCase().replace(/[^0-9K]/g, "");
const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Busca una respuesta por fragmento del título de la pregunta. */
function buscar(resp: Record<string, string | string[]>, ...fragmentos: string[]): string {
  for (const [pregunta, valor] of Object.entries(resp)) {
    const p = sinTildes(pregunta);
    if (fragmentos.every(f => p.includes(sinTildes(f)))) {
      return Array.isArray(valor) ? valor.join(", ") : String(valor ?? "");
    }
  }
  return "";
}

export async function POST(req: NextRequest) {
  const secreto = process.env.GOOGLE_FORMS_WEBHOOK_SECRET;
  if (!secreto) {
    return NextResponse.json({ error: "Integración no configurada: falta GOOGLE_FORMS_WEBHOOK_SECRET" }, { status: 503 });
  }
  if (req.headers.get("x-webhook-secret") !== secreto) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Payload;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body?.responseId || !body.respuestas || typeof body.respuestas !== "object") {
    return NextResponse.json({ error: "Faltan responseId o respuestas" }, { status: 400 });
  }

  // Idempotente: Apps Script reintenta si la red falla, y eso no puede
  // duplicar el checklist.
  const yaExiste = await db.vehicleChecklist.findUnique({
    where: { formularioRespuestaId: body.responseId }, select: { id: true },
  });
  if (yaExiste) return NextResponse.json({ ok: true, checklistId: yaExiste.id, duplicado: true });

  const r = body.respuestas;
  const patente = buscar(r, "patente");
  if (!patente) return NextResponse.json({ error: "La respuesta no trae patente" }, { status: 422 });

  const vehiculos = await db.vehicle.findMany({ select: { id: true, plate: true, type: true } });
  let vehiculo = vehiculos.find(v => normPatente(v.plate) === normPatente(patente)) ?? null;
  let vehiculoCreado = false;
  if (!vehiculo) {
    // Patente que no está en la flota: se crea el vehículo. Antes se
    // rechazaba para no inventar uno con una patente mal escrita, pero la
    // empresa arrienda vehículos, y un checklist rechazado es un checklist
    // perdido. Se crea marcado como externo —empresa "Arrendado / externo",
    // estado de acreditación pendiente— para que se distinga en la flota, y
    // si era un error de tipeo, se ve y se corrige desde la ficha.
    const marcaModelo = buscar(r, "interno", "marca") || buscar(r, "marca") || "";
    const creado = await db.vehicle.create({
      data: {
        plate: patente.toUpperCase().trim(),
        brand: marcaModelo.split(/[·\-–/]/)[0]?.trim() || "Por definir",
        model: marcaModelo.trim() || "Por definir",
        type: "Camioneta",
        company: "Arrendado / externo",
        internalCode: buscar(r, "interno").trim() || null,
        status: "OPERATIVO",
        accreditationStatus: "PENDIENTE",
        notes: `Creado automáticamente desde el formulario de checklist el ${new Date().toISOString().slice(0, 10)}. Completar datos y documentos.`,
      },
      select: { id: true, plate: true, type: true },
    });
    vehiculo = creado;
    vehiculoCreado = true;
  }

  const conductorNombre = buscar(r, "nombre del conductor") || buscar(r, "conductor") || null;
  const conductorRut = buscar(r, "rut") || null;
  const email = (body.email || buscar(r, "correo")).trim().toLowerCase();
  const usuario = email
    ? await db.user.findUnique({ where: { email }, select: { id: true } })
    : null;

  const kmRaw = buscar(r, "kilometraje").replace(/[^\d]/g, "");
  const odometerKm = kmRaw ? Number(kmRaw) : 0;
  const combustible = buscar(r, "combustible");
  const fuelPercent = /full/i.test(combustible) ? 100
    : combustible.includes("3/4") ? 75 : combustible.includes("1/2") ? 50 : combustible.includes("1/4") ? 25 : 0;
  const fechaTxt = buscar(r, "fecha de la inspecci");
  const fecha = fechaTxt && !Number.isNaN(Date.parse(fechaTxt)) ? new Date(fechaTxt)
    : body.timestamp && !Number.isNaN(Date.parse(body.timestamp)) ? new Date(body.timestamp)
    : new Date();

  // Veredicto por la convención del SGI: NC en un ítem ★ bloquea; NC en otro
  // deja observación. Se recorre todo, sin saber de antemano qué preguntas hay.
  const sgi = evaluarRespuestasSGI(r);
  const bloqueos = [...sgi.bloqueos];
  const avisos = [...sgi.avisos];

  // Si el formulario trae milímetros por neumático, se evalúan igual que en
  // la app. Si no los trae, no se inventan.
  const plantilla = plantillaPara(vehiculo.type);
  const neumaticos: NeumaticoMedido[] = [];
  for (const pos of plantilla.posiciones) {
    const mm = buscar(r, "mm", sinTildes(pos.split(" ")[0]), sinTildes(pos.split(" ")[1] ?? ""));
    const n = Number(mm.replace(",", "."));
    if (mm && Number.isFinite(n)) neumaticos.push({ posicion: pos, mm: n, estado: null });
  }
  if (neumaticos.length > 0) {
    const v = evaluarChecklist({
      plantilla, neumaticos,
      comunes: Object.fromEntries(ITEMS_COMUNES.map(i => [i.clave, true])),
      extras: Object.fromEntries(plantilla.extras.map(i => [i.clave, true])),
    });
    bloqueos.push(...v.motivos.filter(m => v.resultado === "no_apto"));
    if (v.resultado === "apto_con_observaciones") avisos.push(...v.motivos);
  }

  const resultado = bloqueos.length > 0 ? "no_apto" : avisos.length > 0 ? "apto_con_observaciones" : "apto";
  const motivos = bloqueos.length > 0 ? bloqueos : avisos;

  const checklist = await db.vehicleChecklist.create({
    data: {
      vehicleId: vehiculo.id,
      driverId: usuario?.id ?? null,
      conductorNombre,
      conductorRut: conductorRut ? normRut(conductorRut) : null,
      origen: "google_forms",
      formularioRespuestaId: body.responseId,
      respuestas: r as never,
      date: fecha,
      odometerKm,
      fuelPercent,
      observations: [
        buscar(r, "da\u00f1os en carrocer") ? `Carrocería: ${buscar(r, "da\u00f1os en carrocer")}` : null,
        buscar(r, "desviaciones") ? `Desviaciones: ${buscar(r, "desviaciones")}` : null,
        buscar(r, "supervisor") ? `Supervisor: ${buscar(r, "supervisor")}` : null,
        buscar(r, "observaci") || null,
      ].filter(Boolean).join("\n") || null,
      incidentReported: bloqueos.length > 0,
      neumaticos: neumaticos.length > 0 ? (neumaticos as never) : undefined,
      resultado,
      resultadoMotivo: motivos.length > 0 ? motivos.join(" · ") : null,
      tiresOk: !motivos.some(m => /neum|rueda|mm/i.test(m)),
    },
    select: { id: true },
  });

  // Fotos: se guardan como enlaces a Drive. El almacén de archivos ya tiene
  // el campo `url` previsto para archivos externos, y la ruta que los sirve
  // redirige a él.
  const urls = Object.values(body.archivos ?? {}).flat().filter(u => typeof u === "string" && u.startsWith("http"));
  for (const [i, url] of urls.slice(0, 12).entries()) {
    const archivo = await db.archivoAcreditacion.create({
      data: { url, originalFilename: `formulario-${i + 1}`, mimeType: "image/jpeg", subidoPorNombre: conductorNombre ?? "Formulario" },
      select: { id: true },
    }).catch(() => null);
    if (archivo) await db.checklistFoto.create({ data: { checklistId: checklist.id, archivoId: archivo.id, orden: i } }).catch(() => {});
  }

  if (odometerKm > 0) {
    await db.vehicle.update({ where: { id: vehiculo.id }, data: { odometerKm } }).catch(() => {});
  }

  return NextResponse.json({
    ok: true, checklistId: checklist.id, resultado, motivos,
    vehiculoCreado: vehiculoCreado ? vehiculo.plate : undefined,
  });
}
