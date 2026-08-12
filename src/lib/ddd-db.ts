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

/**
 * Personas a las que se les puede asignar un compromiso.
 *
 * Son los usuarios activos de la plataforma. No es una lista cerrada: el
 * responsable se sigue guardando como texto, porque en un daily se compromete
 * gente que no tiene cuenta — un jefe de turno, un proveedor, alguien del
 * mandante. Perder ese compromiso por no poder asignarlo es peor que tenerlo
 * a nombre de alguien sin usuario.
 */
export async function getPersonasAsignables(): Promise<
  Array<{ nombre: string; cargo: string | null }>
> {
  const filas = await db.user.findMany({
    where: { isActive: true },
    select: { name: true, positionTitle: true },
    orderBy: { name: "asc" },
  });
  return filas
    .filter(f => f.name.trim())
    .map(f => ({ nombre: f.name.trim(), cargo: f.positionTitle }));
}

/**
 * Responsables para el filtro del tablero.
 *
 * Mezcla los usuarios activos con los nombres que ya aparecen en algún
 * compromiso: si alguien quedó registrado como responsable y después se
 * desactivó su usuario, sus compromisos siguen ahí y hay que poder filtrarlos.
 */
export async function getResponsables(): Promise<string[]> {
  const [filas, personas] = await Promise.all([
    db.compromiso.findMany({
      distinct: ["responsable"],
      select: { responsable: true },
      orderBy: { responsable: "asc" },
    }),
    getPersonasAsignables(),
  ]);

  const todos = new Set<string>();
  for (const p of personas) todos.add(p.nombre);
  for (const f of filas) if (f.responsable) todos.add(f.responsable);

  return [...todos].sort((a, b) => a.localeCompare(b, "es"));
}
