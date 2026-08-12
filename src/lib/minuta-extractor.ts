import { openaiChatCompletion } from "./openai";

/**
 * Convierte la transcripción de una reunión en registros del DdD.
 *
 * La transcripción viene de reconocimiento de voz y viene sucia. El criterio
 * que atraviesa todo el prompt es el mismo del resto de la app: preferir un
 * campo vacío y marcado a un dato inventado que parezca correcto, porque el
 * dato inventado nadie lo cuestiona.
 */

export type PropuestaMinuta = {
  resumen: string;
  compromisos_nuevos: CompromisoPropuesto[];
  amenazas_nuevas: AmenazaPropuesta[];
  rdp_nuevos: RdpPropuesto[];
  gemba_nuevos: GembaPropuesto[];
  cierres: Array<{ id: string; fecha_cierre_real: string | null; evidencia: string }>;
  cierres_dudosos: Array<{ id: string; razon: string; evidencia: string }>;
  reprogramaciones: Array<{ id: string; fecha_nueva: string; motivo: string; evidencia: string }>;
  fuera_de_alcance: Array<{ tema: string; instancia_sugerida: string }>;
};

export type CompromisoPropuesto = {
  oportunidad: string; accion: string; responsable: string;
  contrato: string | null; fecha_cierre: string | null;
  observacion: string; requiere_verificacion: boolean; evidencia: string;
};
export type AmenazaPropuesta = {
  area: string; descripcion: string; responsable: string;
  contrato: string | null; fecha_cierre: string | null;
  observacion: string; requiere_verificacion: boolean; evidencia: string;
};
export type RdpPropuesto = {
  problema: string; causa_raiz: string | null; accion_correctiva: string | null;
  lider: string; fecha_cierre: string | null; evidencia: string;
};
export type GembaPropuesto = {
  observador: string; descripcion: string; area: string;
  lider: string; fecha_cierre: string | null; evidencia: string;
};

export const VERSION_PROMPT = "minuta-v1";

const SISTEMA = `Eres un asistente que convierte transcripciones de reuniones operativas en registros
estructurados de un sistema de gestión llamado DdD (Diálogo de Desempeño), usado por
Nómade Chile, una empresa de campamentos, alimentación y logística para faena minera
remota en Chile.

REGLAS ABSOLUTAS
1. No inventes. Si un dato no está en la transcripción, déjalo vacío. Nunca completes
   con lo que "probablemente" quiso decir alguien.
2. La transcripción viene de reconocimiento automático de voz y viene sucia: hay
   palabras en otros idiomas, nombres propios mal transcritos, frases cortadas y
   repeticiones. Trabaja con lo que se entiende y descarta el ruido.
3. Todo nombre propio, patente, monto o cifra que no esté escrito con claridad debe
   marcarse con requiere_verificacion = true. No lo omitas: márcalo.
4. Escribe en español de Chile, registro profesional y directo. Sin jerga corporativa,
   sin "se sugiere", sin "sería importante".
5. Las acciones se redactan en infinitivo y empiezan con el verbo:
   "Cotizar un segundo camión de combustible", no "Rody va a cotizar un camión".
6. Una acción por registro. Si en una frase hay dos cosas que hacer, son dos registros.

CÓMO CLASIFICAR
- COMPROMISO: algo que alguien se comprometió a hacer, con o sin fecha explícita.
  Si no hay fecha en la transcripción, propone una y márcala como requiere_verificacion.
- AMENAZA: algo que puede impedir cumplir un compromiso o detener la operación, haya
  ocurrido o no. Una pana, un rechazo del mandante, un atraso de un tercero, un riesgo
  de costo, una falta de capacidad.
- RdP: un problema que se repite, o que ya costó plata o días. No es una incidencia
  cualquiera. Debe llevar causa raíz y acción correctiva. Si en la conversación no se
  identificó la causa raíz, déjala vacía en vez de inventarla.
- GEMBA: una observación hecha en terreno por alguien que estuvo ahí y lo vio.
- FUERA DE ALCANCE: temas de planificación de mediano plazo, cobranza, contratos
  comerciales, presupuestos y estructura. No son de la coordinación diaria. Van en el
  arreglo "fuera_de_alcance" con una sugerencia de a qué instancia corresponden.

CIERRE DE COMPROMISOS ANTERIORES
Recibirás la lista de compromisos y amenazas abiertos. Cuando en la transcripción se
diga que algo ya se hizo, se resolvió, "ya pasó", "ya está listo" o "se cerró", devuelve
ese id en "cierres" con la evidencia textual que lo respalda. Si la transcripción es
ambigua sobre si se cerró, NO lo cierres: devuélvelo en "cierres_dudosos".
Cuando un compromiso abierto se discuta y se le dé una fecha nueva, devuélvelo en
"reprogramaciones" con la fecha nueva y el motivo.

FECHAS
Resuelve las fechas relativas contra la fecha de la reunión que se te entrega.
"Mañana", "el jueves", "la otra semana", "el 18". Si la referencia es ambigua, usa la
interpretación más conservadora (la más tardía) y marca requiere_verificacion.

TONO DEL RESUMEN
El resumen son 3 a 5 líneas con lo que un gerente necesita saber si no estuvo: qué se
cerró, qué está en riesgo, qué decisión quedó pendiente. Sin adjetivos.

EVIDENCIA
El campo "evidencia" es OBLIGATORIO en todos los registros: la cita textual de la
transcripción que respalda el dato. Sin evidencia nadie confía en lo que extrajo el
sistema, y con razón.

Devuelve SOLO JSON válido con esta forma:
{"resumen":"","compromisos_nuevos":[{"oportunidad":"","accion":"","responsable":"","contrato":null,"fecha_cierre":"YYYY-MM-DD","observacion":"","requiere_verificacion":false,"evidencia":""}],
"amenazas_nuevas":[{"area":"","descripcion":"","responsable":"","contrato":null,"fecha_cierre":"YYYY-MM-DD","observacion":"","requiere_verificacion":false,"evidencia":""}],
"rdp_nuevos":[{"problema":"","causa_raiz":null,"accion_correctiva":null,"lider":"","fecha_cierre":"YYYY-MM-DD","evidencia":""}],
"gemba_nuevos":[{"observador":"","descripcion":"","area":"","lider":"","fecha_cierre":"YYYY-MM-DD","evidencia":""}],
"cierres":[{"id":"","fecha_cierre_real":"YYYY-MM-DD","evidencia":""}],
"cierres_dudosos":[{"id":"","razon":"","evidencia":""}],
"reprogramaciones":[{"id":"","fecha_nueva":"YYYY-MM-DD","motivo":"","evidencia":""}],
"fuera_de_alcance":[{"tema":"","instancia_sugerida":"comite_semanal|comite_mensual|reunion_aparte"}]}`;

export type ContextoExtraccion = {
  fecha: string;
  tipo: string;
  participantes: string[];
  contratos: string[];
  categorias: string[];
  compromisosAbiertos: Array<{ id: string; accion: string; responsable: string; vence: string }>;
  amenazasAbiertas: Array<{ id: string; descripcion: string; responsable: string }>;
  transcripcion: string;
};

/** Umbral por sobre el cual la transcripción se parte en bloques. */
const MAX_CARACTERES = 28_000;

function construirUsuario(ctx: ContextoExtraccion, transcripcion: string): string {
  return [
    `FECHA DE LA REUNIÓN: ${ctx.fecha}`,
    `TIPO: ${ctx.tipo}`,
    `PARTICIPANTES: ${ctx.participantes.join(", ") || "no informados"}`,
    `CONTRATOS ACTIVOS: ${ctx.contratos.join(", ") || "ninguno"}`,
    `CATEGORÍAS VÁLIDAS: ${ctx.categorias.join(", ")}`,
    "",
    "COMPROMISOS ABIERTOS:",
    ...ctx.compromisosAbiertos.map(c => `  [${c.id}] ${c.accion} — ${c.responsable} — vence ${c.vence}`),
    "",
    "AMENAZAS ABIERTAS:",
    ...ctx.amenazasAbiertas.map(a => `  [${a.id}] ${a.descripcion} — ${a.responsable}`),
    "",
    "TRANSCRIPCIÓN:",
    transcripcion,
  ].join("\n");
}

function vacia(): PropuestaMinuta {
  return {
    resumen: "", compromisos_nuevos: [], amenazas_nuevas: [], rdp_nuevos: [],
    gemba_nuevos: [], cierres: [], cierres_dudosos: [], reprogramaciones: [],
    fuera_de_alcance: [],
  };
}

/**
 * Parte la transcripción en bloques con solape, para que un compromiso que
 * cae justo en el corte no se pierda por la mitad.
 */
function enBloques(texto: string): string[] {
  if (texto.length <= MAX_CARACTERES) return [texto];
  const solape = Math.floor(MAX_CARACTERES * 0.1);
  const bloques: string[] = [];
  for (let i = 0; i < texto.length; i += MAX_CARACTERES - solape) {
    bloques.push(texto.slice(i, i + MAX_CARACTERES));
  }
  return bloques;
}

const claveAccion = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim().slice(0, 60);

export async function extraerMinuta(
  ctx: ContextoExtraccion,
  model = "gpt-4o-mini",
): Promise<PropuestaMinuta> {
  const bloques = enBloques(ctx.transcripcion);
  const salida = vacia();
  const vistos = new Set<string>();

  for (const bloque of bloques) {
    const respuesta = await openaiChatCompletion({
      model,
      responseFormat: "json_object",
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: construirUsuario(ctx, bloque) },
      ],
      temperature: 0,
      maxTokens: 6000,
    });

    let p: Partial<PropuestaMinuta> = {};
    try { p = JSON.parse(respuesta.choices[0]?.message.content ?? "{}"); } catch { continue; }

    // Los bloques se fusionan deduplicando por acción: el solape hace que un
    // compromiso del borde aparezca dos veces, y eso no es un compromiso nuevo.
    for (const c of p.compromisos_nuevos ?? []) {
      const k = claveAccion(c.accion ?? "");
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      salida.compromisos_nuevos.push(c);
    }
    for (const a of p.amenazas_nuevas ?? []) {
      const k = "am:" + claveAccion(a.descripcion ?? "");
      if (vistos.has(k)) continue;
      vistos.add(k);
      salida.amenazas_nuevas.push(a);
    }
    for (const r of p.rdp_nuevos ?? []) {
      const k = "rdp:" + claveAccion(r.problema ?? "");
      if (vistos.has(k)) continue;
      vistos.add(k);
      salida.rdp_nuevos.push(r);
    }
    salida.gemba_nuevos.push(...(p.gemba_nuevos ?? []));
    salida.fuera_de_alcance.push(...(p.fuera_de_alcance ?? []));

    for (const c of p.cierres ?? []) if (!salida.cierres.some(x => x.id === c.id)) salida.cierres.push(c);
    for (const c of p.cierres_dudosos ?? []) if (!salida.cierres_dudosos.some(x => x.id === c.id)) salida.cierres_dudosos.push(c);
    for (const r of p.reprogramaciones ?? []) if (!salida.reprogramaciones.some(x => x.id === r.id)) salida.reprogramaciones.push(r);

    if (p.resumen && !salida.resumen) salida.resumen = p.resumen;
  }

  return salida;
}
