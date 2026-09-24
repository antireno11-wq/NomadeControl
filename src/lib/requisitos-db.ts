import { db } from "@/lib/db";
import {
  getEstadoDocumental, getTiposDocumento, recontar,
  type EstadoPorTipo, type EstadoTrabajador, type TipoDocumentoRow,
} from "@/lib/acreditacion-db";
import { diasRestantes, esEstadoOk, UMBRAL_POR_VENCER_DIAS, type EstadoDocumento } from "@/lib/acreditacion";
import {
  AJUSTES_CONDICION,
  CARGOS_SEED,
  PROGRAMAS_SEED,
  REGLAS_INTERNAS_NOMADE,
  REGLAS_MANDANTE_ANGLO,
  TIPOS_SOLO_SI_EL_CLIENTE_LOS_EXIGE,
  REGLAS_SEED,
  reglasDelPrograma,
  requisitoAplica,
  type CondicionesTrabajador,
  type CondicionRequisito,
  type NivelRequisito,
} from "@/lib/requisitos";

export type CargoRow = { id: string; nombre: string; orden: number };

export type ProyectoRow = {
  id: string;
  nombre: string;
  ambito: string;
  faena: string | null;
  altitudMsnm: number | null;
  mandanteId: string;
  mandanteNombre: string;
};

export type RequisitoRow = {
  id: string;
  cargoId: string;
  tipoId: string;
  nivel: NivelRequisito;
  condicion: CondicionRequisito | null;
  vigenciaMeses: number | null;
  nota: string | null;
};

/** Cargos activos, ordenados. Se auto-siembran con los 10 de la dotación. */
export async function getCargos(): Promise<CargoRow[]> {
  const existentes = await db.cargo.findMany({ select: { nombre: true } });
  const nombres = new Set(existentes.map(c => c.nombre));
  const faltantes = CARGOS_SEED.filter(c => !nombres.has(c.nombre));
  if (faltantes.length > 0) {
    await db.cargo.createMany({ data: faltantes, skipDuplicates: true });
  }
  return db.cargo.findMany({
    where: { activo: true },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, orden: true },
  });
}

/**
 * Aplica una vez por proceso las condiciones que faltan en matrices viejas.
 * Es un UPDATE ... WHERE condicion IS NULL: idempotente y sin efecto sobre
 * las filas que alguien ya definió desde la grilla.
 */
let condicionesReconciliadas = false;
async function reconciliarCondiciones(): Promise<void> {
  if (condicionesReconciliadas) return;
  condicionesReconciliadas = true;

  const codigos = [...AJUSTES_CONDICION.map(a => a.tipo), ...TIPOS_SOLO_SI_EL_CLIENTE_LOS_EXIGE];
  const tipos = await db.tipoDocumento.findMany({
    where: { codigo: { in: codigos } },
    select: { id: true, codigo: true },
  });

  for (const ajuste of AJUSTES_CONDICION) {
    const tipo = tipos.find(t => t.codigo === ajuste.tipo);
    if (!tipo) continue;
    await db.requisitoDocumento.updateMany({
      where: { tipoId: tipo.id, condicion: null },
      data: { condicion: ajuste.condicion },
    });
  }

  // Las dos correcciones que siguen son de UN programa, no de todos. Se
  // escribieron para la matriz de Anglo y se aplicaban a cualquier proyecto:
  // la segunda borraba la ODI de Monte Mina en cada arranque del servidor,
  // porque la planilla de Anglo dice que la ODI va "solo si el cliente la
  // exige" — y Transelec sí la exige. Ahora cada proyecto se corrige con las
  // reglas del programa que lo definió.
  const proyectos = await db.proyecto.findMany({
    select: { id: true, nombre: true, ambito: true, mandante: { select: { nombre: true } } },
  });
  const reglasDe = (p: (typeof proyectos)[number]) =>
    reglasDelPrograma(p.mandante?.nombre ?? "", p.nombre)
    ?? (p.ambito === "interno" ? REGLAS_INTERNAS_NOMADE : REGLAS_MANDANTE_ANGLO);

  const todosLosCodigos = [...new Set(
    proyectos.flatMap(p => reglasDe(p).filter(r => r.alternativaDe).map(r => r.tipo)),
  )];
  const tiposAlt = await db.tipoDocumento.findMany({
    where: { codigo: { in: todosLosCodigos } },
    select: { id: true, codigo: true },
  });
  const idPorCodigo = new Map([...tiposAlt, ...tipos].map(t => [t.codigo, t.id]));

  for (const proyecto of proyectos) {
    const reglas = reglasDe(proyecto);

    // Las alternativas quedaron vacías en las matrices que se sembraron antes
    // de que existiera la columna. Sin esto, tener el examen de altura seguía
    // dejando pendiente el ocupacional, cuando la mutualidad los emite en un
    // solo certificado. Se rellena solo donde está en NULL, así que no pisa
    // una decisión manual.
    for (const regla of reglas.filter(r => r.alternativaDe)) {
      const tipoId = idPorCodigo.get(regla.tipo);
      if (!tipoId) continue;
      await db.requisitoDocumento.updateMany({
        where: { proyectoId: proyecto.id, tipoId, alternativaDe: null },
        data: { alternativaDe: regla.alternativaDe },
      });
    }

    // Los que se sembraron por error: están en el catálogo del mandante pero
    // sin columna en SU matriz. Solo si el programa de este proyecto no los
    // pide, y solo si nadie los tocó desde la grilla —updatedAt igual a
    // createdAt—: una decisión manual manda.
    const pedidos = new Set(reglas.map(r => r.tipo));
    const idsRetirar = TIPOS_SOLO_SI_EL_CLIENTE_LOS_EXIGE
      .filter(c => !pedidos.has(c))
      .map(c => idPorCodigo.get(c))
      .filter((id): id is string => Boolean(id));
    if (idsRetirar.length === 0) continue;

    const candidatos = await db.requisitoDocumento.findMany({
      where: { proyectoId: proyecto.id, tipoId: { in: idsRetirar } },
      select: { id: true, createdAt: true, updatedAt: true },
    });
    const intactos = candidatos
      .filter(r => r.updatedAt.getTime() === r.createdAt.getTime())
      .map(r => r.id);
    if (intactos.length > 0) {
      await db.requisitoDocumento.deleteMany({ where: { id: { in: intactos } } });
    }
  }
}

/**
 * Crea los programas de requisitos que vienen definidos en el código y saca de
 * la matriz del mandante los documentos que resultaron ser de contratación.
 *
 * Se hace acá y no con un botón porque es configuración, no una acción: la
 * app tiene que llegar con las dos matrices puestas. Los requisitos que
 * alguien ya tocó desde la grilla no se mueven —updatedAt sigue igual a
 * createdAt—, así que una decisión manual siempre gana.
 */
let programasSembrados = false;
async function asegurarProgramas(): Promise<void> {
  if (programasSembrados) return;
  programasSembrados = true;

  for (const prog of PROGRAMAS_SEED) {
    const mandante = await db.mandante.upsert({
      where: { nombre: prog.mandante }, update: {}, create: { nombre: prog.mandante },
    });
    const existente = await db.proyecto.findUnique({
      where: { mandanteId_nombre: { mandanteId: mandante.id, nombre: prog.proyecto } },
      select: { id: true },
    });
    const proyectoId = existente?.id ?? (await db.proyecto.create({
      data: {
        mandanteId: mandante.id, nombre: prog.proyecto,
        ambito: prog.ambito, faena: prog.faena ?? null,
      },
      select: { id: true },
    })).id;

    await sembrarMatriz(proyectoId);
  }

  await sembrarRequisitosDeRigger();
  // Idempotente y una vez por proceso. Va acá para que la tabla de
  // acreditaciones no arranque vacía el día que el cálculo la use.
  await migrarAcreditaciones().catch(() => {});

  // Los documentos de contratación que había sembrado por error en la matriz
  // del mandante: se quitan de ahí, donde bloqueaban el ingreso a faena. En la
  // matriz interna siguen exigiéndose.
  // Contra todos los programas de mandante, no solo el de Anglo: un tipo que
  // Transelec sí exige no es "de contratación" aunque Anglo no lo pida.
  const deAlgunMandante = new Set(
    PROGRAMAS_SEED.filter(p => p.ambito === "mandante").flatMap(p => p.reglas.map(r => r.tipo)),
  );
  const soloInternos = REGLAS_INTERNAS_NOMADE
    .map(r => r.tipo)
    .filter(t => !deAlgunMandante.has(t));

  const tipos = await db.tipoDocumento.findMany({
    where: { codigo: { in: soloInternos } }, select: { id: true },
  });
  if (tipos.length === 0) return;

  const candidatos = await db.requisitoDocumento.findMany({
    where: {
      tipoId: { in: tipos.map(t => t.id) },
      proyecto: { ambito: "mandante" },
    },
    select: { id: true, createdAt: true, updatedAt: true },
  });
  const intactos = candidatos
    .filter(r => r.updatedAt.getTime() === r.createdAt.getTime())
    .map(r => r.id);
  if (intactos.length > 0) {
    await db.requisitoDocumento.deleteMany({ where: { id: { in: intactos } } });
  }
}

/**
 * Requisitos que cuelgan de la calificación de rigger.
 *
 * Van acá y no en las reglas por cargo porque rigger no es un cargo: es una
 * habilitación que la persona tiene además del suyo. Se siembran una vez por
 * cada cargo y proyecto que ya tengan matriz, y solo si no existen — quien
 * los edite o los borre desde la grilla manda por sobre esto.
 */
async function sembrarRequisitosDeRigger(): Promise<void> {
  // Se asegura la calificación acá en vez de esperar a que otra pantalla la
  // cree: esto corría al arrancar y `getCalificaciones` solo se llama al abrir
  // la ficha de un trabajador, así que en una base nueva los requisitos del
  // rigger no se sembraban hasta el siguiente reinicio del servidor.
  await getCalificaciones().catch(() => {});
  const rigger = await db.calificacion.findUnique({
    where: { nombre: "Rigger" }, select: { id: true },
  });
  if (!rigger) return;

  const tipos = await db.tipoDocumento.findMany({
    where: { codigo: { in: ["curso_rigger", "carnet_rigger"] } },
    select: { id: true },
  });
  if (tipos.length === 0) return;

  // Sobre los pares proyecto+cargo que ya tienen matriz: sin eso habría que
  // adivinar a qué cargos puede alcanzarles la calificación, y la respuesta
  // es a cualquiera que la tenga marcada.
  const pares = await db.requisitoDocumento.findMany({
    distinct: ["proyectoId", "cargoId"],
    select: { proyectoId: true, cargoId: true },
  });
  if (pares.length === 0) return;

  await db.requisitoDocumento.createMany({
    data: pares.flatMap(par => tipos.map(t => ({
      proyectoId: par.proyectoId,
      cargoId: par.cargoId,
      tipoId: t.id,
      nivel: "obligatorio",
      calificacionId: rigger.id,
    }))),
    skipDuplicates: true,
  });
}

/**
 * Le da a un cargo los mismos requisitos que otro, en todos los proyectos.
 *
 * Un cargo recién creado no tiene ninguna fila de requisito, en ninguna
 * matriz. Quien quedaba asignado ahí aparecía "sin matriz" ante el mandante,
 * y peor: la contratación interna también quedaba vacía, y como ese aviso se
 * oculta cuando no hay matriz, no se le revisaban ni antecedentes ni
 * manipulación de alimentos, sin que nada lo dijera.
 *
 * Copiar de un cargo parecido —el auxiliar de cocina se acredita igual que
 * el ayudante— respeta todo lo que ya se ajustó a mano en cada matriz: los
 * plazos, las notas, lo que se quitó. Sembrarlo de nuevo desde las reglas
 * del código deshacería esos ajustes para el cargo nuevo.
 */
export async function copiarRequisitosDeCargo(origenId: string, destinoId: string): Promise<number> {
  if (origenId === destinoId) return 0;
  const filas = await db.requisitoDocumento.findMany({
    where: { cargoId: origenId },
    select: {
      proyectoId: true, tipoId: true, nivel: true, condicion: true,
      alternativaDe: true, vigenciaMeses: true, calificacionId: true, nota: true,
    },
  });
  if (filas.length === 0) return 0;
  const { count } = await db.requisitoDocumento.createMany({
    data: filas.map(f => ({ ...f, cargoId: destinoId })),
    skipDuplicates: true,
  });
  return count;
}

/** Proyectos activos con su mandante. */
export async function getProyectos(): Promise<ProyectoRow[]> {
  await reconciliarCondiciones().catch(() => { condicionesReconciliadas = false; });
  await asegurarProgramas().catch(() => { programasSembrados = false; });

  const filas = await db.proyecto.findMany({
    where: { activo: true },
    orderBy: [{ mandante: { nombre: "asc" } }, { nombre: "asc" }],
    select: {
      id: true, nombre: true, ambito: true, faena: true, altitudMsnm: true,
      mandante: { select: { id: true, nombre: true } },
    },
  });
  return filas.map(p => ({
    id: p.id, nombre: p.nombre, ambito: p.ambito, faena: p.faena, altitudMsnm: p.altitudMsnm,
    mandanteId: p.mandante.id, mandanteNombre: p.mandante.nombre,
  }));
}

export async function getRequisitos(proyectoId: string): Promise<RequisitoRow[]> {
  const filas = await db.requisitoDocumento.findMany({
    where: { proyectoId },
    select: { id: true, cargoId: true, tipoId: true, nivel: true, condicion: true, vigenciaMeses: true, nota: true },
  });
  return filas as RequisitoRow[];
}

/**
 * Siembra la matriz por defecto de un proyecto recién creado.
 *
 * Solo corre si el proyecto no tiene ningún requisito: nunca pisa una matriz
 * que alguien ya ajustó a mano. Los seis documentos que la planilla dejaba en
 * "Segun cargo" sin especificar quedan fuera a propósito — ver REGLAS_SEED.
 */
export async function sembrarMatriz(proyectoId: string): Promise<number> {
  const yaTiene = await db.requisitoDocumento.count({ where: { proyectoId } });
  if (yaTiene > 0) return 0;

  const proyecto = await db.proyecto.findUnique({
    where: { id: proyectoId },
    select: { altitudMsnm: true, ambito: true, nombre: true, mandante: { select: { nombre: true } } },
  });
  if (!proyecto) return 0;

  // Las reglas del programa que definió ESTE proyecto. Antes todo proyecto de
  // mandante recibía las de Anglo, así que agregar Transelec a la lista de
  // programas habría sembrado Monte Mina con los requisitos de Los Bronces,
  // sin error y sin que nadie lo notara hasta que el mandante rechazara a
  // alguien. Un proyecto creado a mano desde Administración, que no tiene
  // programa, sigue partiendo de la matriz de Anglo como plantilla.
  const reglas =
    reglasDelPrograma(proyecto.mandante?.nombre ?? "", proyecto.nombre)
    ?? (proyecto.ambito === "interno" ? REGLAS_INTERNAS_NOMADE : REGLAS_MANDANTE_ANGLO);

  const [cargos, tipos] = await Promise.all([getCargos(), getTiposDocumento()]);
  const porNombre = new Map(cargos.map(c => [c.nombre, c.id]));
  const porCodigo = new Map(tipos.map(t => [t.codigo, t.id]));

  const data: Array<{
    proyectoId: string; cargoId: string; tipoId: string;
    nivel: string; condicion: string | null; nota: string | null;
    alternativaDe: string | null; vigenciaMeses: number | null;
  }> = [];

  for (const regla of reglas) {
    const tipoId = porCodigo.get(regla.tipo);
    if (!tipoId) continue;

    let nota: string | null = regla.nota ?? null;
    if (regla.sobreMsnm != null) {
      // Sin altura registrada se exige igual: un documento de más se ve en
      // la matriz, uno de menos no se ve hasta que el mandante lo rechaza.
      if (proyecto.altitudMsnm != null && proyecto.altitudMsnm < regla.sobreMsnm) continue;
      if (proyecto.altitudMsnm == null) {
        const aviso = `Aplica sobre ${regla.sobreMsnm.toLocaleString("es-CL")} m. Confirmar la altura de la faena.`;
        nota = nota ? `${nota} ${aviso}` : aviso;
      }
    }

    const destinos = regla.cargos ?? cargos.map(c => c.nombre);
    for (const nombreCargo of destinos) {
      const cargoId = porNombre.get(nombreCargo);
      if (!cargoId) continue;
      data.push({
        proyectoId, cargoId, tipoId,
        nivel: regla.nivel,
        condicion: regla.condicion ?? null,
        alternativaDe: regla.alternativaDe ?? null,
        vigenciaMeses: regla.vigenciaMeses ?? null,
        nota,
      });
    }
  }

  if (data.length === 0) return 0;
  const { count } = await db.requisitoDocumento.createMany({ data, skipDuplicates: true });
  return count;
}

// ─── Evaluación por trabajador ─────────────────────────────────────────

/** Datos de la ficha que activan o desactivan requisitos condicionales. */
export type TrabajadorParaRequisitos = {
  id?: string;
  proyectoId: string | null;
  cargoId: string | null;
  /** Habilitaciones que tiene además de su cargo. Sin ellas no se le exigen
   *  los documentos que cuelgan de una calificación. */
  calificacionIds?: string[];
  contractIsIndefinite: boolean;
  trabajoPrevioMandante: boolean;
  contractEndDate: Date | null;
};

/**
 * Un contrato a plazo fijo cuya fecha de término ya pasó. El indefinido no
 * vence nunca, y si no hay fecha cargada no se puede afirmar que venció:
 * en los dos casos el anexo de renovación no corresponde todavía.
 */
export function condicionesDe(t: TrabajadorParaRequisitos, hoy = new Date()): CondicionesTrabajador {
  return {
    contratoIndefinido:    t.contractIsIndefinite,
    trabajoPrevioMandante: t.trabajoPrevioMandante,
    contratoVencido:
      !t.contractIsIndefinite && t.contractEndDate != null && t.contractEndDate < hoy,
  };
}

export type AmbitoRequisito = "mandante" | "interno";

export type RequisitoDeTrabajador = {
  tipoId: string;
  nivel: NivelRequisito;
  condicion: CondicionRequisito | null;
  /** De qué matriz viene. Decide si bloquea la habilitación o solo informa. */
  ambito: AmbitoRequisito;
  proyectoNombre: string;
  /** Se cumple con cualquiera de los requisitos que compartan esta clave. */
  alternativaDe: string | null;
  /** Plazo propio del mandante, en meses desde la emisión. */
  vigenciaMeses: number | null;
};

/**
 * Documentos que le corresponden a un trabajador según su proyecto, su cargo
 * y sus propias condiciones. Sin proyecto o sin cargo devuelve `null`, que la
 * UI muestra como "sin matriz asignada" en vez de fingir un 100%.
 */
export async function getRequisitosDeTrabajador(
  t: TrabajadorParaRequisitos & { id?: string },
): Promise<RequisitoDeTrabajador[] | null> {
  // Se resuelve con la versión por lote para no duplicar la lógica de los dos
  // ámbitos, que ya es la parte delicada.
  const mapa = await getRequisitosPorTrabajador([{ ...t, id: t.id ?? "único" }]);
  return mapa.get(t.id ?? "único") ?? null;
}

/** Igual que el anterior pero para muchos trabajadores, sin N+1. */
export async function getRequisitosPorTrabajador(
  trabajadores: Array<TrabajadorParaRequisitos & { id: string }>,
): Promise<Map<string, RequisitoDeTrabajador[] | null>> {
  const pares = new Set(
    trabajadores
      .filter(t => t.proyectoId && t.cargoId)
      .map(t => `${t.proyectoId}|${t.cargoId}`),
  );

  // Los requisitos internos de NOMADE aplican a toda la dotación, sin importar
  // en qué proyecto esté la persona: son de la contratación, no de la faena.
  const cargoIds = [...new Set(trabajadores.map(t => t.cargoId).filter(Boolean) as string[])];

  const filas = pares.size === 0 && cargoIds.length === 0 ? [] : await db.requisitoDocumento.findMany({
    where: {
      tipo: { activo: true },
      OR: [
        ...[...pares].map(p => {
          const [proyectoId, cargoId] = p.split("|");
          return { proyectoId, cargoId };
        }),
        { proyecto: { ambito: "interno", activo: true }, cargoId: { in: cargoIds } },
      ],
    },
    select: {
      proyectoId: true, cargoId: true, tipoId: true, nivel: true, condicion: true,
      alternativaDe: true, calificacionId: true, vigenciaMeses: true,
      proyecto: { select: { ambito: true, nombre: true } },
    },
  });

  const porPar = new Map<string, typeof filas>();
  const internosPorCargo = new Map<string, typeof filas>();
  for (const f of filas) {
    if (f.proyecto?.ambito === "interno") {
      const lista = internosPorCargo.get(f.cargoId);
      if (lista) lista.push(f); else internosPorCargo.set(f.cargoId, [f]);
      continue;
    }
    const k = `${f.proyectoId}|${f.cargoId}`;
    const lista = porPar.get(k);
    if (lista) lista.push(f);
    else porPar.set(k, [f]);
  }

  const salida = new Map<string, RequisitoDeTrabajador[] | null>();
  for (const t of trabajadores) {
    if (!t.cargoId) { salida.set(t.id, null); continue; }
    const cond = condicionesDe(t);
    const delProyecto = t.proyectoId ? porPar.get(`${t.proyectoId}|${t.cargoId}`) ?? [] : [];
    const internos = internosPorCargo.get(t.cargoId) ?? [];

    // Sin proyecto asignado igual se evalúa lo interno: la contratación no
    // depende de a qué faena vaya la persona.
    if (delProyecto.length === 0 && internos.length === 0) { salida.set(t.id, null); continue; }

    // Un requisito atado a una calificación solo aplica a quien la tiene. Al
    // resto no se le pide ni le aparece como faltante: pedirle el carnet de
    // rigger a un maestro de cocina es exactamente el ruido que hace que
    // nadie mire la lista de pendientes.
    const suyas = new Set(t.calificacionIds ?? []);

    salida.set(
      t.id,
      [...delProyecto, ...internos]
        .filter(f => !f.calificacionId || suyas.has(f.calificacionId))
        .filter(f => requisitoAplica(f, cond))
        .map(f => ({
          tipoId: f.tipoId,
          nivel: f.nivel as NivelRequisito,
          condicion: f.condicion as CondicionRequisito | null,
          ambito: (f.proyecto?.ambito === "interno" ? "interno" : "mandante") as AmbitoRequisito,
          proyectoNombre: f.proyecto?.nombre ?? "",
          alternativaDe: f.alternativaDe,
          vigenciaMeses: f.vigenciaMeses,
        })),
    );
  }
  return salida;
}

// ─── Vigencia propia del mandante ──────────────────────────────────────

/**
 * Suma meses sin desbordar: 31 de enero + 1 mes es 28 de febrero, no 3 de
 * marzo. En un plazo de acreditación, tres días de más son tres días en que
 * alguien entra a faena con un papel que ya no vale.
 */
function sumarMeses(fecha: Date, meses: number): Date {
  const destino = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + meses, 1, 12));
  const ultimoDia = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0, 12)).getUTCDate();
  destino.setUTCDate(Math.min(fecha.getUTCDate(), ultimoDia));
  return destino;
}

/**
 * El estado de un documento medido con el plazo de un mandante.
 *
 * Gana el más estricto de los dos: lo que dice el papel y lo que exige el
 * mandante. Un examen que vence en diciembre pero se emitió hace 35 meses,
 * bajo un plazo de 36, vence el mes que viene.
 *
 * Sin fecha de emisión no se puede medir el plazo del mandante, y entonces
 * manda el documento. Hoy los RIOHS, EPP y ODI cargados la tienen todos; la
 * excepción son 16 IRL de 73, y lo que corresponde ahí es completar la fecha,
 * no inventarla.
 */
export function estadoConVigencia(
  entry: EstadoPorTipo,
  vigenciaMeses: number | null,
  hoy: Date,
  umbralDias = UMBRAL_POR_VENCER_DIAS,
): EstadoPorTipo {
  if (vigenciaMeses == null || !entry.documento?.fechaEmision) return entry;

  const limite = sumarMeses(entry.documento.fechaEmision, vigenciaMeses);
  const propio = entry.estado === "sin_vencimiento" ? null : entry.documento.fechaVencimiento;
  const vence = propio && propio.getTime() < limite.getTime() ? propio : limite;
  const dias = diasRestantes(vence, hoy)!;

  return {
    ...entry,
    estado: dias < 0 ? "vencido" : dias <= umbralDias ? "por_vencer" : "vigente",
    dias,
    venceSegunMandante: vence,
  };
}

/**
 * Aplica a cada trabajador los plazos que pone SU mandante.
 *
 * Se hace una vez, sobre el mismo estado que después leen la matriz, el
 * dashboard, la ficha y el export. Si cada pantalla lo aplicara por su
 * cuenta volveríamos a tener un cumplimiento distinto en cada una, que es
 * exactamente lo que se arregló.
 *
 * Solo se miran los requisitos del mandante. Si la contratación interna
 * pidiera el mismo papel, también lo vería con el plazo del mandante: es la
 * lectura más estricta, y hoy no hay ningún tipo que pidan los dos.
 */
export function aplicarVigenciasDelMandante(
  estados: Map<string, EstadoTrabajador>,
  requisitos: Map<string, RequisitoDeTrabajador[] | null>,
  hoy = new Date(),
): void {
  for (const [id, estado] of estados) {
    const reqs = requisitos.get(id);
    if (!reqs) continue;

    let cambio = false;
    for (const r of reqs) {
      if (r.ambito !== "mandante" || r.vigenciaMeses == null) continue;
      const entry = estado.porTipo.get(r.tipoId);
      if (!entry) continue;
      const ajustado = estadoConVigencia(entry, r.vigenciaMeses, hoy);
      if (ajustado !== entry) {
        estado.porTipo.set(r.tipoId, ajustado);
        cambio = true;
      }
    }
    if (cambio) recontar(estado);
  }
}

/**
 * Estado documental y requisitos de un grupo de trabajadores, listos para
 * resumir. Es LA forma de calcular cumplimiento: todas las pantallas y el
 * export pasan por acá.
 *
 * Existe porque cada pantalla armaba el cálculo con sus propias piezas y se
 * les olvidaban distintas: solo la ficha le pasaba las calificaciones, así
 * que a un rigger la ficha le exigía documentos que la matriz no le contaba.
 * Con los plazos del mandante habría pasado lo mismo. Una sola función es la
 * única forma de que una pieza nueva llegue a todas las pantallas a la vez.
 */
export async function getCumplimiento(
  trabajadores: Array<TrabajadorParaRequisitos & { id: string }>,
  tipos: TipoDocumentoRow[],
  hoy = new Date(),
): Promise<{
  estados: Map<string, EstadoTrabajador>;
  requisitos: Map<string, RequisitoDeTrabajador[] | null>;
}> {
  const ids = trabajadores.map(t => t.id);
  const [estados, calificaciones] = await Promise.all([
    getEstadoDocumental(ids, tipos, hoy),
    getCalificacionesPorTrabajador(ids),
  ]);
  const requisitos = await getRequisitosPorTrabajador(trabajadores.map(t => ({
    ...t,
    calificacionIds: t.calificacionIds ?? calificaciones.get(t.id) ?? [],
  })));
  aplicarVigenciasDelMandante(estados, requisitos, hoy);
  return { estados, requisitos };
}

// ─── Cumplimiento: qué le falta de verdad a cada trabajador ────────────


export type DocFaltante = {
  tipoId: string;
  nombre: string;
  estado: EstadoDocumento;
};

export type ResumenExigencia = {
  /** Sin proyecto o sin cargo no hay matriz: no se puede afirmar que cumple. */
  sinMatriz: boolean;
  obligatorios: number;
  cumplidos: number;
  /** Obligatorios nunca cargados. */
  faltantes: DocFaltante[];
  /** Obligatorios cargados pero vencidos. */
  vencidos: DocFaltante[];
  /** Obligatorios por vencer dentro del umbral. */
  porVencer: DocFaltante[];
  /** Deseables faltantes: informan, no bloquean. */
  deseablesFaltantes: DocFaltante[];
  /** Cumplidos sobre obligatorios. `null` si no hay matriz. */
  porcentaje: number | null;
  /** Nombre del proyecto o programa que exige estos documentos. */
  fuente?: string;
};

/**
 * Cruza la matriz de requisitos con el estado documental real.
 *
 * El porcentaje se calcula solo sobre los obligatorios que le corresponden a
 * ese cargo — no sobre el catálogo completo, que es lo que hundía el avance
 * en la planilla. Sin matriz devuelve `porcentaje: null` en vez de 100%:
 * un trabajador sin cargo asignado no está acreditado, está sin evaluar.
 */
export function resumirExigencia(
  requisitos: RequisitoDeTrabajador[] | null,
  estado: EstadoTrabajador | undefined,
  nombrePorTipo: Map<string, string>,
  /**
   * Qué matriz medir. Son cumplimientos separados: que falte un papel de la
   * contratación de NOMADE no puede botar la acreditación de una faena que
   * no lo pide. Por defecto se mide la del mandante, que es la que bloquea.
   */
  ambito: AmbitoRequisito = "mandante",
): ResumenExigencia {
  const vacio: ResumenExigencia = {
    sinMatriz: true, obligatorios: 0, cumplidos: 0,
    faltantes: [], vencidos: [], porVencer: [], deseablesFaltantes: [],
    porcentaje: null,
  };
  if (!requisitos) return vacio;

  const delAmbito = requisitos.filter(r => r.ambito === ambito);
  if (delAmbito.length === 0) return vacio;

  const faltantes: DocFaltante[] = [];
  const vencidos: DocFaltante[] = [];
  const porVencer: DocFaltante[] = [];
  const deseablesFaltantes: DocFaltante[] = [];
  let obligatorios = 0;
  let cumplidos = 0;

  // Los requisitos alternativos se resuelven en grupo: basta uno. Si alguno
  // está al día, los demás del grupo no se cuentan ni como faltantes ni en el
  // denominador — es un solo documento pedido de dos formas.
  const alternativasCumplidas = new Set(
    delAmbito
      .filter(r => r.alternativaDe && esEstadoOk(estado?.porTipo.get(r.tipoId)?.estado ?? "sin_fecha"))
      .map(r => r.alternativaDe!),
  );
  const alternativaYaContada = new Set<string>();

  for (const req of delAmbito) {
    if (req.alternativaDe) {
      if (alternativasCumplidas.has(req.alternativaDe)) {
        // Cuenta una sola vez, con el documento que sí está.
        if (!esEstadoOk(estado?.porTipo.get(req.tipoId)?.estado ?? "sin_fecha")) continue;
        if (alternativaYaContada.has(req.alternativaDe)) continue;
        alternativaYaContada.add(req.alternativaDe);
      } else {
        // Ninguno está: se reporta como faltante una sola vez, nombrando las
        // opciones, para no pedir dos veces el mismo papel.
        if (alternativaYaContada.has(req.alternativaDe)) continue;
        alternativaYaContada.add(req.alternativaDe);
        if (req.nivel === "obligatorio") {
          obligatorios++;
          faltantes.push({
            tipoId: req.tipoId,
            nombre: delAmbito
              .filter(r => r.alternativaDe === req.alternativaDe)
              .map(r => nombrePorTipo.get(r.tipoId) ?? "Documento")
              .join(" o "),
            estado: "sin_fecha",
          });
        }
        continue;
      }
    }

    const est = estado?.porTipo.get(req.tipoId)?.estado ?? "sin_fecha";
    const doc: DocFaltante = {
      tipoId: req.tipoId,
      nombre: nombrePorTipo.get(req.tipoId) ?? "Tipo de documento no disponible",
      estado: est,
    };

    if (req.nivel === "deseable") {
      if (!esEstadoOk(est)) deseablesFaltantes.push(doc);
      continue;
    }

    obligatorios++;
    // "por vencer" está cargado y vigente HOY: cuenta como cumplido y se
    // avisa aparte. Tratarlo como faltante lo hacía aparecer al mismo tiempo
    // en «sin cargar» y en «por vencer», que es una contradicción visible en
    // la ficha: el documento estaba ahí abajo, con su fecha.
    if (esEstadoOk(est) || est === "por_vencer") {
      cumplidos++;
      continue;
    }
    if (est === "vencido") vencidos.push(doc);
    else faltantes.push(doc);
  }

  // Los por vencer sí están cumplidos, pero hay que verlos venir.
  for (const req of delAmbito) {
    if (req.nivel !== "obligatorio") continue;
    if (estado?.porTipo.get(req.tipoId)?.estado === "por_vencer") {
      porVencer.push({
        tipoId: req.tipoId,
        nombre: nombrePorTipo.get(req.tipoId) ?? "Tipo de documento no disponible",
        estado: "por_vencer",
      });
    }
  }

  return {
    sinMatriz: false,
    fuente: delAmbito[0]?.proyectoNombre || undefined,
    obligatorios, cumplidos,
    faltantes, vencidos, porVencer, deseablesFaltantes,
    porcentaje: obligatorios === 0 ? 100 : Math.round((cumplidos / obligatorios) * 100),
  };
}

/** ¿Este trabajador tiene algún obligatorio faltante o vencido? */
export function tieneBloqueos(r: ResumenExigencia): boolean {
  return r.faltantes.length > 0 || r.vencidos.length > 0;
}

export type TotalesCumplimiento = {
  /** Trabajadores con matriz asignada. Es la base de todos los demás. */
  medidos: number;
  sinMatriz: number;
  bloqueados: number;
  /** Suma de obligatorios de cada cargo. NUNCA el catálogo completo. */
  obligatorios: number;
  cumplidos: number;
  vencidos: number;
  faltantes: number;
  porVencer: number;
  /** cumplidos / obligatorios. `null` si nadie tiene matriz. */
  porcentaje: number | null;
};

/**
 * Los números de cabecera, calculados UNA vez para todas las pantallas.
 *
 * Existe porque cada vista se hacía su propia suma y las tres daban
 * distinto: la matriz dividía por el catálogo completo (20 trabajadores ×
 * 9 columnas = 180) y marcaba 37%, mientras el dashboard dividía por los
 * obligatorios de cada cargo y marcaba 100%. Los dos números eran
 * defendibles por separado y juntos no significaban nada, que es lo peor
 * que le puede pasar a un dato que se le muestra al mandante.
 *
 * El denominador es siempre lo que el cargo exige. Si una pantalla necesita
 * otro recorte, filtra la lista ANTES de llamar acá — no rehace la suma.
 */
export function totalizarExigencias(resumenes: ResumenExigencia[]): TotalesCumplimiento {
  const conMatriz = resumenes.filter(r => !r.sinMatriz);
  const obligatorios = conMatriz.reduce((s, r) => s + r.obligatorios, 0);
  const cumplidos = conMatriz.reduce((s, r) => s + r.cumplidos, 0);

  return {
    medidos: conMatriz.length,
    sinMatriz: resumenes.length - conMatriz.length,
    bloqueados: conMatriz.filter(tieneBloqueos).length,
    obligatorios,
    cumplidos,
    vencidos:  conMatriz.reduce((s, r) => s + r.vencidos.length, 0),
    faltantes: conMatriz.reduce((s, r) => s + r.faltantes.length, 0),
    porVencer: conMatriz.reduce((s, r) => s + r.porVencer.length, 0),
    porcentaje: obligatorios === 0 ? null : Math.round((cumplidos / obligatorios) * 100),
  };
}

/**
 * Qué tipos le corresponden a cada trabajador, para pintar el resto como
 * "No aplica" en vez de como un hueco.
 *
 * Incluye los deseables: que no bloqueen no quiere decir que no se pidan.
 */
export function tiposExigidosPorTrabajador(
  requisitos: Map<string, RequisitoDeTrabajador[] | null>,
  ambito: AmbitoRequisito = "mandante",
): Map<string, Set<string> | null> {
  const salida = new Map<string, Set<string> | null>();
  for (const [id, reqs] of requisitos) {
    if (!reqs) { salida.set(id, null); continue; }
    const delAmbito = reqs.filter(r => r.ambito === ambito);
    // Sin matriz de ese ámbito no se puede afirmar que algo "no aplica":
    // no se sabe qué aplica. `null` lo distingue de un conjunto vacío.
    salida.set(id, delAmbito.length === 0 ? null : new Set(delAmbito.map(r => r.tipoId)));
  }
  return salida;
}

// ─── Calificaciones ─────────────────────────────────────────────────────────

/**
 * Catálogo de calificaciones.
 *
 * Lo administra el usuario desde la aplicación, no está fijo en el código:
 * cada mandante y cada faena piden habilitaciones distintas, y una lista
 * inventada acá se llena de opciones muertas. Solo se siembra "Rigger",
 * que es la que ya tiene documentos en el catálogo, y solo si la tabla está
 * vacía — para no revivirla si alguien la desactiva.
 */
export async function getCalificaciones(soloActivas = true) {
  const total = await db.calificacion.count();
  if (total === 0) {
    await db.calificacion.create({
      data: {
        nombre: "Rigger",
        descripcion: "Habilita para dirigir maniobras de izaje. Exige curso y carnet vigentes.",
        orden: 10,
      },
    });
  }
  return db.calificacion.findMany({
    where: soloActivas ? { activo: true } : {},
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, descripcion: true, activo: true, orden: true },
  });
}

/** Las calificaciones de cada trabajador, sin N+1. */
export async function getCalificacionesPorTrabajador(
  staffIds: string[],
): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  if (staffIds.length === 0) return mapa;

  const filas = await db.staffMember.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, calificaciones: { select: { id: true } } },
  });
  for (const f of filas) mapa.set(f.id, f.calificaciones.map(c => c.id));
  return mapa;
}

// ─── Acreditaciones por faena ───────────────────────────────────────────────

let acreditacionesMigradas = false;

/**
 * Lleva el `proyectoId` suelto de cada trabajador a la tabla de acreditaciones.
 *
 * Es idempotente y no destructivo: `skipDuplicates` sobre la clave
 * (trabajador, proyecto), y `StaffMember.proyectoId` se mantiene intacto. Todo
 * el cálculo de exigencia sigue leyendo de ahí mientras dure la transición, así
 * que esto no puede romper la acreditación que ya funciona.
 */
export async function migrarAcreditaciones(): Promise<void> {
  if (acreditacionesMigradas) return;
  acreditacionesMigradas = true;

  const conProyecto = await db.staffMember.findMany({
    where: { proyectoId: { not: null } },
    select: { id: true, proyectoId: true },
  });
  if (conProyecto.length === 0) return;

  await db.trabajadorProyecto.createMany({
    data: conProyecto.map(t => ({
      staffMemberId: t.id,
      proyectoId: t.proyectoId!,
    })),
    skipDuplicates: true,
  });
}

/** Faenas vigentes de cada trabajador, sin N+1. */
export async function getAcreditacionesPorTrabajador(
  staffIds: string[],
): Promise<Map<string, Array<{ proyectoId: string; cargoId: string | null }>>> {
  const mapa = new Map<string, Array<{ proyectoId: string; cargoId: string | null }>>();
  if (staffIds.length === 0) return mapa;

  const filas = await db.trabajadorProyecto.findMany({
    // `hasta` con fecha es una faena de la que ya salió: no se le exige nada.
    where: { staffMemberId: { in: staffIds }, hasta: null },
    select: { staffMemberId: true, proyectoId: true, cargoId: true },
  });
  for (const f of filas) {
    const lista = mapa.get(f.staffMemberId);
    const item = { proyectoId: f.proyectoId, cargoId: f.cargoId };
    if (lista) lista.push(item); else mapa.set(f.staffMemberId, [item]);
  }
  return mapa;
}
