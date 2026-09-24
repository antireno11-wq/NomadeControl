import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTiposDocumento } from "@/lib/acreditacion-db";
import {
  getCumplimiento, resumirExigencia, tieneBloqueos,
  tiposExigidosPorTrabajador, totalizarExigencias,
} from "@/lib/requisitos-db";
import { CELDA_STYLE, type EstadoCelda } from "@/lib/acreditacion";

/**
 * Matriz de acreditación en Excel, para mandarle al mandante.
 *
 * Sale del MISMO cálculo que la pantalla —`getCumplimiento` y
 * `resumirExigencia`— y no de una consulta propia. Un export que arma sus
 * números por su cuenta es el quinto lugar donde el cumplimiento puede dar
 * distinto, y sería el peor de todos: es el único que sale de la empresa.
 *
 * Tres hojas: el resumen por persona, la matriz completa y el detalle de lo
 * que falta. La última es la que sirve para trabajar; las otras dos, para
 * mostrar.
 */
function fechaChile(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

export async function GET(request: NextRequest) {
  await requireRole(TRABAJADORES_ROLES);

  const proyectoId = request.nextUrl.searchParams.get("proyecto") ?? "";
  const hoy = new Date();

  const [tiposMatriz, tiposTodos, proyecto] = await Promise.all([
    getTiposDocumento(true),
    getTiposDocumento(),
    proyectoId
      ? db.proyecto.findUnique({ where: { id: proyectoId }, select: { nombre: true, mandante: { select: { nombre: true } } } })
      : Promise.resolve(null),
  ]);

  const staff = await db.staffMember.findMany({
    where: { isActive: true, ...(proyectoId ? { proyectoId } : {}) },
    select: {
      id: true, fullName: true, nationalId: true, cargoId: true, proyectoId: true,
      contractIsIndefinite: true, trabajoPrevioMandante: true, contractEndDate: true,
      cargo: { select: { nombre: true } },
      camp: { select: { name: true } },
      proyecto: { select: { nombre: true, mandante: { select: { nombre: true } } } },
    },
    orderBy: { fullName: "asc" },
  });

  const { estados: estado, requisitos } = await getCumplimiento(
    staff.map(w => ({
      id: w.id, proyectoId: w.proyectoId, cargoId: w.cargoId,
      contractIsIndefinite: w.contractIsIndefinite,
      trabajoPrevioMandante: w.trabajoPrevioMandante,
      contractEndDate: w.contractEndDate,
    })),
    tiposTodos,
    hoy,
  );

  const nombrePorTipo = new Map(tiposTodos.map(t => [t.id, t.nombre]));
  const exigidos = tiposExigidosPorTrabajador(requisitos);

  const filas = staff.map(w => ({
    w,
    exigencia: resumirExigencia(requisitos.get(w.id) ?? null, estado.get(w.id), nombrePorTipo),
    aplica: (tipoId: string) => {
      const suyos = exigidos.get(w.id) ?? null;
      return suyos === null || suyos.has(tipoId);
    },
  }));

  const totales = totalizarExigencias(filas.map(f => f.exigencia));
  const libro = XLSX.utils.book_new();

  // ── Hoja 1: resumen por persona ────────────────────────────────────────
  const resumen = filas.map(({ w, exigencia }) => ({
    "Trabajador": w.fullName,
    "RUT": w.nationalId ?? "",
    "Cargo": w.cargo?.nombre ?? "Sin grupo de dotación",
    "Proyecto": w.proyecto ? `${w.proyecto.mandante?.nombre ?? ""} — ${w.proyecto.nombre}`.replace(/^ — /, "") : "Sin proyecto",
    "Campamento": w.camp?.name ?? "",
    "Habilitable": exigencia.sinMatriz ? "Sin evaluar" : tieneBloqueos(exigencia) ? "NO" : "Sí",
    "Obligatorios": exigencia.obligatorios,
    "Al día": exigencia.cumplidos,
    "% Cumplimiento": exigencia.porcentaje == null ? "" : exigencia.porcentaje / 100,
    "Vencidos": exigencia.vencidos.length,
    "Sin cargar": exigencia.faltantes.length,
    "Por vencer (30d)": exigencia.porVencer.length,
  }));

  const hojaResumen = XLSX.utils.json_to_sheet(resumen);
  // El porcentaje como número con formato, no como texto: así el mandante
  // puede ordenar y filtrar la planilla que le mandamos.
  for (let i = 0; i < resumen.length; i++) {
    const celda = hojaResumen[XLSX.utils.encode_cell({ r: i + 1, c: 8 })];
    if (celda && typeof celda.v === "number") celda.z = "0%";
  }
  hojaResumen["!cols"] = [{ wch: 34 }, { wch: 14 }, { wch: 22 }, { wch: 28 }, { wch: 16 },
    { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 15 }, { wch: 10 }, { wch: 11 }, { wch: 16 }];
  hojaResumen["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: resumen.length, c: 11 } }) };
  XLSX.utils.book_append_sheet(libro, hojaResumen, "Resumen");

  // ── Hoja 2: la matriz ──────────────────────────────────────────────────
  // "N/A" donde el cargo no lo exige. Es la diferencia entre una planilla que
  // el mandante puede leer y cuarenta celdas grises que no distinguen entre
  // "falta" y "no corresponde".
  const matriz = filas.map(({ w, aplica }) => {
    const fila: Record<string, string> = {
      "Trabajador": w.fullName,
      "RUT": w.nationalId ?? "",
      "Cargo": w.cargo?.nombre ?? "",
    };
    for (const t of tiposMatriz) {
      const e = estado.get(w.id)?.porTipo.get(t.id);
      const celdaEstado: EstadoCelda = aplica(t.id) ? (e?.estado ?? "sin_fecha") : "no_aplica";
      if (celdaEstado === "no_aplica" && !e?.documento) { fila[t.nombre] = "N/A"; continue; }
      if (celdaEstado === "sin_vencimiento") { fila[t.nombre] = "No vence"; continue; }
      const vence = e?.venceSegunMandante ?? e?.documento?.fechaVencimiento;
      fila[t.nombre] = vence
        ? `${fechaChile(vence)} · ${CELDA_STYLE[celdaEstado].label}`
        : CELDA_STYLE[celdaEstado].label;
    }
    return fila;
  });

  const hojaMatriz = XLSX.utils.json_to_sheet(matriz);
  hojaMatriz["!cols"] = [{ wch: 34 }, { wch: 14 }, { wch: 22 }, ...tiposMatriz.map(() => ({ wch: 20 }))];
  hojaMatriz["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: matriz.length, c: tiposMatriz.length + 2 } }) };
  XLSX.utils.book_append_sheet(libro, hojaMatriz, "Matriz");

  // ── Hoja 3: qué falta, línea por línea ─────────────────────────────────
  const pendientes = filas.flatMap(({ w, exigencia }) => [
    ...exigencia.vencidos.map(d => ({ d, situacion: "Vencido" })),
    ...exigencia.faltantes.map(d => ({ d, situacion: "Sin cargar" })),
    ...exigencia.porVencer.map(d => ({ d, situacion: "Por vencer" })),
  ].map(({ d, situacion }) => {
    const e = estado.get(w.id)?.porTipo.get(d.tipoId);
    return {
      "Trabajador": w.fullName,
      "RUT": w.nationalId ?? "",
      "Cargo": w.cargo?.nombre ?? "",
      "Documento": d.nombre,
      "Situación": situacion,
      "Vence": fechaChile(e?.venceSegunMandante ?? e?.documento?.fechaVencimiento),
      "Días": e?.dias ?? "",
      "Bloquea la habilitación": situacion === "Por vencer" ? "No" : "Sí",
    };
  }));

  const hojaPendientes = XLSX.utils.json_to_sheet(
    pendientes.length > 0
      ? pendientes
      : [{ "Trabajador": "", "RUT": "", "Cargo": "", "Documento": "Sin pendientes", "Situación": "", "Vence": "", "Días": "", "Bloquea la habilitación": "" }],
  );
  hojaPendientes["!cols"] = [{ wch: 34 }, { wch: 14 }, { wch: 22 }, { wch: 40 }, { wch: 13 }, { wch: 12 }, { wch: 8 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(libro, hojaPendientes, "Pendientes");

  // ── Hoja 4: de dónde salen los números ─────────────────────────────────
  const alcance = proyecto
    ? `${proyecto.mandante?.nombre ?? ""} — ${proyecto.nombre}`.replace(/^ — /, "")
    : "Todos los proyectos";
  const ficha = [
    ["Matriz de acreditación", ""],
    ["Alcance", alcance],
    ["Emitido", hoy.toLocaleString("es-CL", { timeZone: "America/Santiago" })],
    ["", ""],
    ["Trabajadores activos", filas.length],
    ["Con matriz asignada", totales.medidos],
    ["Sin proyecto o cargo", totales.sinMatriz],
    ["No habilitables", totales.bloqueados],
    ["", ""],
    ["Obligatorios exigidos", totales.obligatorios],
    ["Al día", totales.cumplidos],
    ["% Cumplimiento", totales.porcentaje == null ? "Sin evaluar" : `${totales.porcentaje}%`],
    ["Vencidos", totales.vencidos],
    ["Sin cargar", totales.faltantes],
    ["Por vencer (30 días)", totales.porVencer],
    ["", ""],
    ["Cómo se cuenta", "Solo los documentos que la matriz del mandante le exige a cada cargo."],
    ["", "Lo que el cargo no exige aparece como N/A y no cuenta como pendiente."],
    ["", "De cada documento se toma la última versión vigente; las anteriores quedan como historial."],
    ["", "Si el mandante pone su propio plazo (por ejemplo 36 meses para el RIOHS), el vencimiento se cuenta desde la emisión y gana el más estricto entre ese y el impreso."],
    ["", "La contratación interna de NOMADE se mide aparte y no está en estas cifras."],
  ];
  const hojaFicha = XLSX.utils.aoa_to_sheet(ficha);
  hojaFicha["!cols"] = [{ wch: 26 }, { wch: 95 }];
  XLSX.utils.book_append_sheet(libro, hojaFicha, "Cómo leer esto");

  const buffer = XLSX.write(libro, { type: "buffer", bookType: "xlsx" });
  const nombreArchivo = `matriz-acreditacion-${alcance.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-${hoy.toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
