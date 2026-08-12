import { db } from "@/lib/db";
import { CATEGORIAS_SEED, KPI_SEED } from "@/lib/ddd";

/**
 * Catálogo de categorías de compromiso. Se auto-siembra igual que el de
 * tipos de documento: la app tiene que llegar usable, sin un paso de
 * inicialización que alguien tenga que recordar.
 */
export async function getCategorias(): Promise<Array<{ id: string; nombre: string }>> {
  const existentes = await db.categoriaCompromiso.findMany({ select: { nombre: true } });
  const nombres = new Set(existentes.map(c => c.nombre));
  const faltantes = CATEGORIAS_SEED
    .map((nombre, i) => ({ nombre, orden: (i + 1) * 10 }))
    .filter(c => !nombres.has(c.nombre));

  if (faltantes.length > 0) {
    await db.categoriaCompromiso.createMany({ data: faltantes, skipDuplicates: true });
  }

  return db.categoriaCompromiso.findMany({
    where: { activo: true },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true },
  });
}

/** Definiciones de KPI del DdD, sembradas la primera vez. */
export async function getKpis() {
  const existentes = await db.kpiDefinicion.count();
  if (existentes === 0) {
    await db.kpiDefinicion.createMany({
      data: KPI_SEED.map((k, i) => ({ ...k, orden: (i + 1) * 10 })),
      skipDuplicates: true,
    });
  }
  return db.kpiDefinicion.findMany({
    where: { activo: true },
    orderBy: [{ orden: "asc" }],
    select: { id: true, parametro: true, nombre: true },
  });
}

/** Los responsables que ya aparecen en algún compromiso, para filtrar. */
export async function getResponsables(): Promise<string[]> {
  const filas = await db.compromiso.findMany({
    distinct: ["responsable"],
    select: { responsable: true },
    orderBy: { responsable: "asc" },
  });
  return filas.map(f => f.responsable).filter(Boolean);
}
