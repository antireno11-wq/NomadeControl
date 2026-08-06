import { db } from "@/lib/db";
import { getTiposDocumento, type EstadoTrabajador } from "@/lib/acreditacion-db";
import { esEstadoOk, type EstadoDocumento } from "@/lib/acreditacion";
import {
  AJUSTES_CONDICION,
  CARGOS_SEED,
  REGLAS_SEED,
  requisitoAplica,
  type CondicionesTrabajador,
  type CondicionRequisito,
  type NivelRequisito,
} from "@/lib/requisitos";

export type CargoRow = { id: string; nombre: string; orden: number };

export type ProyectoRow = {
  id: string;
  nombre: string;
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

  const tipos = await db.tipoDocumento.findMany({
    where: { codigo: { in: AJUSTES_CONDICION.map(a => a.tipo) } },
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
}

/** Proyectos activos con su mandante. */
export async function getProyectos(): Promise<ProyectoRow[]> {
  await reconciliarCondiciones().catch(() => { condicionesReconciliadas = false; });

  const filas = await db.proyecto.findMany({
    where: { activo: true },
    orderBy: [{ mandante: { nombre: "asc" } }, { nombre: "asc" }],
    select: {
      id: true, nombre: true, faena: true, altitudMsnm: true,
      mandante: { select: { id: true, nombre: true } },
    },
  });
  return filas.map(p => ({
    id: p.id, nombre: p.nombre, faena: p.faena, altitudMsnm: p.altitudMsnm,
    mandanteId: p.mandante.id, mandanteNombre: p.mandante.nombre,
  }));
}

export async function getRequisitos(proyectoId: string): Promise<RequisitoRow[]> {
  const filas = await db.requisitoDocumento.findMany({
    where: { proyectoId },
    select: { id: true, cargoId: true, tipoId: true, nivel: true, condicion: true, nota: true },
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
    where: { id: proyectoId }, select: { altitudMsnm: true },
  });
  if (!proyecto) return 0;

  const [cargos, tipos] = await Promise.all([getCargos(), getTiposDocumento()]);
  const porNombre = new Map(cargos.map(c => [c.nombre, c.id]));
  const porCodigo = new Map(tipos.map(t => [t.codigo, t.id]));

  const data: Array<{
    proyectoId: string; cargoId: string; tipoId: string;
    nivel: string; condicion: string | null; nota: string | null;
  }> = [];

  for (const regla of REGLAS_SEED) {
    const tipoId = porCodigo.get(regla.tipo);
    if (!tipoId) continue;

    let nota: string | null = null;
    if (regla.sobreMsnm != null) {
      // Sin altura registrada se exige igual: un documento de más se ve en
      // la matriz, uno de menos no se ve hasta que el mandante lo rechaza.
      if (proyecto.altitudMsnm != null && proyecto.altitudMsnm < regla.sobreMsnm) continue;
      if (proyecto.altitudMsnm == null) {
        nota = `Aplica sobre ${regla.sobreMsnm.toLocaleString("es-CL")} m. Confirmar la altura de la faena.`;
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

export type RequisitoDeTrabajador = {
  tipoId: string;
  nivel: NivelRequisito;
  condicion: CondicionRequisito | null;
};

/**
 * Documentos que le corresponden a un trabajador según su proyecto, su cargo
 * y sus propias condiciones. Sin proyecto o sin cargo devuelve `null`, que la
 * UI muestra como "sin matriz asignada" en vez de fingir un 100%.
 */
export async function getRequisitosDeTrabajador(
  t: TrabajadorParaRequisitos,
): Promise<RequisitoDeTrabajador[] | null> {
  if (!t.proyectoId || !t.cargoId) return null;

  const filas = await db.requisitoDocumento.findMany({
    // Un tipo desactivado en Administración deja de exigirse. La fila del
    // requisito se conserva —reactivar el tipo lo vuelve a pedir— pero no
    // cuenta: antes se sumaba como obligatorio faltante y, como el catálogo
    // ya no lo devolvía, aparecía en la ficha con el nombre «Documento».
    where: { proyectoId: t.proyectoId, cargoId: t.cargoId, tipo: { activo: true } },
    select: { tipoId: true, nivel: true, condicion: true },
  });

  const cond = condicionesDe(t);

  return filas
    .filter(f => requisitoAplica(f, cond))
    .map(f => ({
      tipoId: f.tipoId,
      nivel: f.nivel as NivelRequisito,
      condicion: f.condicion as CondicionRequisito | null,
    }));
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

  const filas = pares.size === 0 ? [] : await db.requisitoDocumento.findMany({
    where: {
      tipo: { activo: true },
      OR: [...pares].map(p => {
        const [proyectoId, cargoId] = p.split("|");
        return { proyectoId, cargoId };
      }),
    },
    select: { proyectoId: true, cargoId: true, tipoId: true, nivel: true, condicion: true },
  });

  const porPar = new Map<string, typeof filas>();
  for (const f of filas) {
    const k = `${f.proyectoId}|${f.cargoId}`;
    const lista = porPar.get(k);
    if (lista) lista.push(f);
    else porPar.set(k, [f]);
  }

  const salida = new Map<string, RequisitoDeTrabajador[] | null>();
  for (const t of trabajadores) {
    if (!t.proyectoId || !t.cargoId) { salida.set(t.id, null); continue; }
    const cond = condicionesDe(t);
    salida.set(
      t.id,
      (porPar.get(`${t.proyectoId}|${t.cargoId}`) ?? [])
        .filter(f => requisitoAplica(f, cond))
        .map(f => ({
          tipoId: f.tipoId,
          nivel: f.nivel as NivelRequisito,
          condicion: f.condicion as CondicionRequisito | null,
        })),
    );
  }
  return salida;
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
): ResumenExigencia {
  const vacio: ResumenExigencia = {
    sinMatriz: true, obligatorios: 0, cumplidos: 0,
    faltantes: [], vencidos: [], porVencer: [], deseablesFaltantes: [],
    porcentaje: null,
  };
  if (!requisitos) return vacio;

  const faltantes: DocFaltante[] = [];
  const vencidos: DocFaltante[] = [];
  const porVencer: DocFaltante[] = [];
  const deseablesFaltantes: DocFaltante[] = [];
  let obligatorios = 0;
  let cumplidos = 0;

  for (const req of requisitos) {
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
  for (const req of requisitos) {
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
    obligatorios, cumplidos,
    faltantes, vencidos, porVencer, deseablesFaltantes,
    porcentaje: obligatorios === 0 ? 100 : Math.round((cumplidos / obligatorios) * 100),
  };
}

/** ¿Este trabajador tiene algún obligatorio faltante o vencido? */
export function tieneBloqueos(r: ResumenExigencia): boolean {
  return r.faltantes.length > 0 || r.vencidos.length > 0;
}
