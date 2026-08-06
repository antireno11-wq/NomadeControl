import { db } from "@/lib/db";
import { getTiposDocumento } from "@/lib/acreditacion-db";
import {
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

/** Proyectos activos con su mandante. */
export async function getProyectos(): Promise<ProyectoRow[]> {
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
export async function getRequisitosDeTrabajador(t: {
  proyectoId: string | null;
  cargoId: string | null;
  contractIsIndefinite: boolean;
  trabajoPrevioMandante: boolean;
}): Promise<RequisitoDeTrabajador[] | null> {
  if (!t.proyectoId || !t.cargoId) return null;

  const filas = await db.requisitoDocumento.findMany({
    where: { proyectoId: t.proyectoId, cargoId: t.cargoId },
    select: { tipoId: true, nivel: true, condicion: true },
  });

  const cond: CondicionesTrabajador = {
    contratoIndefinido:    t.contractIsIndefinite,
    trabajoPrevioMandante: t.trabajoPrevioMandante,
  };

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
  trabajadores: Array<{
    id: string;
    proyectoId: string | null;
    cargoId: string | null;
    contractIsIndefinite: boolean;
    trabajoPrevioMandante: boolean;
  }>,
): Promise<Map<string, RequisitoDeTrabajador[] | null>> {
  const pares = new Set(
    trabajadores
      .filter(t => t.proyectoId && t.cargoId)
      .map(t => `${t.proyectoId}|${t.cargoId}`),
  );

  const filas = pares.size === 0 ? [] : await db.requisitoDocumento.findMany({
    where: {
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
    const cond: CondicionesTrabajador = {
      contratoIndefinido:    t.contractIsIndefinite,
      trabajoPrevioMandante: t.trabajoPrevioMandante,
    };
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
