/**
 * Checklist de salida por tipo de vehículo.
 *
 * Nació de un hallazgo del mandante: neumáticos desgastados en un vehículo
 * cuyo checklist decía que estaban bien. El formulario venía con todo marcado
 * por defecto y un solo "Neumáticos ✓", así que un conductor apurado lo
 * enviaba sin mirar y quedaba registrado que todo estaba conforme.
 *
 * Dos decisiones salen de ahí:
 *  - Nada viene marcado. Cada ítem se confirma a propósito.
 *  - Los neumáticos se MIDEN: profundidad de dibujo en milímetros por
 *    posición. Un número hay que ir a buscarlo con el medidor; una casilla no.
 *
 * El veredicto lo calcula el sistema, no lo elige el conductor.
 */

export type ResultadoChecklist = "apto" | "apto_con_observaciones" | "no_apto";

export type EstadoNeumatico = "bueno" | "desgaste_parejo" | "desgaste_irregular" | "danado";

export const ESTADOS_NEUMATICO: Array<{ valor: EstadoNeumatico; label: string }> = [
  { valor: "bueno",              label: "Bueno" },
  { valor: "desgaste_parejo",    label: "Desgaste parejo" },
  { valor: "desgaste_irregular", label: "Desgaste irregular (alineación / presión)" },
  { valor: "danado",             label: "Dañado: corte, deformación o clavo" },
];

export type NeumaticoMedido = {
  posicion: string;
  mm: number | null;
  estado: EstadoNeumatico | null;
};

export type ItemChecklist = { clave: string; label: string; critico?: boolean };

export type PlantillaChecklist = {
  /** Etiqueta de cada posición de neumático, en el orden en que se recorren. */
  posiciones: string[];
  /** Bajo esto no sale. Sobre esto pero bajo `mmAviso`, sale con observación. */
  mmMinimo: number;
  mmAviso: number;
  /** Ítems propios del tipo, además de los comunes. */
  extras: ItemChecklist[];
};

/**
 * Ítems comunes a todo vehículo. Los críticos dejan el vehículo NO APTO si
 * quedan sin confirmar; los demás lo dejan apto con observaciones.
 */
export const ITEMS_COMUNES: ItemChecklist[] = [
  { clave: "frontLightsOk",  label: "Luces delanteras",     critico: true },
  { clave: "rearLightsOk",   label: "Luces traseras",       critico: true },
  { clave: "brakesOk",       label: "Frenos",               critico: true },
  { clave: "extinguisherOk", label: "Extintor vigente",     critico: true },
  { clave: "mirrorsOk",      label: "Espejos" },
  { clave: "hornOk",         label: "Bocina" },
  { clave: "fluidsOk",       label: "Fluidos (aceite, agua, frenos)" },
  { clave: "jackOk",         label: "Gata y llave de rueda" },
  { clave: "spareTireOk",    label: "Rueda de repuesto con presión" },
  { clave: "documentsOk",    label: "Documentos a bordo" },
  { clave: "bodyworkOk",     label: "Carrocería sin daños nuevos" },
  { clave: "cleanlinessOk",  label: "Limpieza" },
];

/**
 * Mínimos de dibujo. La ley chilena (DS 22) exige 1,6 mm; los mandantes
 * mineros piden más, y varía por contrato. Estos son valores de partida
 * razonables para faena — CONFIRMAR contra el estándar del mandante antes de
 * confiar en el veredicto.
 */
const LIVIANO: PlantillaChecklist = {
  posiciones: ["Delantero izq.", "Delantero der.", "Trasero izq.", "Trasero der."],
  mmMinimo: 3,
  mmAviso: 4,
  extras: [
    { clave: "barraAntivuelco", label: "Barra antivuelco firme",       critico: true },
    { clave: "gpsOperativo",    label: "GPS operativo",                 critico: true },
    { clave: "pertigaBaliza",   label: "Pértiga y baliza" },
    { clave: "traccion4x4",     label: "Tracción 4x4 engancha" },
    { clave: "cunas",           label: "Cuñas de rueda" },
    { clave: "kitEmergencia",   label: "Kit de emergencia y botiquín" },
  ],
};

const PESADO: PlantillaChecklist = {
  posiciones: [
    "Delantero izq.", "Delantero der.",
    "Trasero izq. ext.", "Trasero izq. int.",
    "Trasero der. ext.", "Trasero der. int.",
  ],
  mmMinimo: 4,
  mmAviso: 5,
  extras: [
    { clave: "frenosAire",     label: "Frenos de aire: presión y sin fugas", critico: true },
    { clave: "sujecionCarga",  label: "Carga sujeta y amarras en buen estado", critico: true },
    { clave: "tacografo",      label: "Tacógrafo operativo" },
    { clave: "engancheQuinta", label: "Enganche / quinta rueda asegurado" },
    { clave: "cunas",          label: "Cuñas de rueda" },
    { clave: "escaleraPasamanos", label: "Escalera y pasamanos de cabina" },
  ],
};

const PASAJEROS: PlantillaChecklist = {
  posiciones: [
    "Delantero izq.", "Delantero der.",
    "Trasero izq. ext.", "Trasero izq. int.",
    "Trasero der. ext.", "Trasero der. int.",
  ],
  mmMinimo: 4,
  mmAviso: 5,
  extras: [
    { clave: "cinturones",      label: "Cinturones en todos los asientos", critico: true },
    { clave: "salidasEmergencia", label: "Salidas de emergencia despejadas", critico: true },
    { clave: "martillos",       label: "Martillos rompevidrios" },
    { clave: "pasamanos",       label: "Pasamanos y peldaños" },
  ],
};

/** Qué plantilla le toca a cada tipo del catálogo de vehículos. */
export function plantillaPara(tipoVehiculo: string): PlantillaChecklist {
  // Comparación exacta y sin tildes. Con `includes` se coló un error de manual:
  // "camioneta" contiene "camion" y caía en la plantilla de camión, con seis
  // ruedas y el mínimo de dibujo equivocado. Y "minibús" con tilde no calzaba
  // con "bus".
  const t = tipoVehiculo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (t === "camion") return PESADO;
  if (t === "bus" || t === "minibus") return PASAJEROS;
  return LIVIANO;
}

/**
 * Veredicto. Se calcula acá y no en el formulario para que la regla sea una
 * sola y quede escrita: un neumático bajo el mínimo es NO APTO aunque todo lo
 * demás esté perfecto.
 */
export function evaluarChecklist(input: {
  plantilla: PlantillaChecklist;
  neumaticos: NeumaticoMedido[];
  comunes: Record<string, boolean>;
  extras: Record<string, boolean>;
}): { resultado: ResultadoChecklist; motivos: string[] } {
  const bloqueos: string[] = [];
  const avisos: string[] = [];
  const { mmMinimo, mmAviso } = input.plantilla;

  for (const n of input.neumaticos) {
    if (n.mm == null) { bloqueos.push(`${n.posicion}: sin medir`); continue; }
    if (n.mm < mmMinimo) bloqueos.push(`${n.posicion}: ${n.mm} mm, bajo el mínimo de ${mmMinimo} mm`);
    else if (n.mm < mmAviso) avisos.push(`${n.posicion}: ${n.mm} mm, cerca del mínimo`);
    if (n.estado === "danado") bloqueos.push(`${n.posicion}: neumático dañado`);
    else if (n.estado === "desgaste_irregular") avisos.push(`${n.posicion}: desgaste irregular, revisar alineación`);
  }

  for (const item of ITEMS_COMUNES) {
    if (input.comunes[item.clave]) continue;
    (item.critico ? bloqueos : avisos).push(`${item.label}: sin confirmar`);
  }
  for (const item of input.plantilla.extras) {
    if (input.extras[item.clave]) continue;
    (item.critico ? bloqueos : avisos).push(`${item.label}: sin confirmar`);
  }

  if (bloqueos.length > 0) return { resultado: "no_apto", motivos: bloqueos };
  if (avisos.length > 0) return { resultado: "apto_con_observaciones", motivos: avisos };
  return { resultado: "apto", motivos: [] };
}

export const RESULTADO_LABEL: Record<ResultadoChecklist, { label: string; tone: "ok" | "warn" | "danger" }> = {
  apto:                   { label: "Apto para salir",         tone: "ok" },
  apto_con_observaciones: { label: "Apto con observaciones",  tone: "warn" },
  no_apto:                { label: "NO APTO — no debe salir", tone: "danger" },
};
