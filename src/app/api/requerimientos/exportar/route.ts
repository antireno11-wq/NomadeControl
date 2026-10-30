import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { requireRequerimientos } from "@/lib/auth";
import {
  codigoReq, diasHasta, estaAbierta, etiquetaPostulante, etiquetaSolicitud, filtrarRequerimientos,
  ordenUrgencia, prioridadDe, textoPlazo, vacantesCubiertas, type FiltrosReq,
} from "@/lib/requerimientos";

function fechaChile(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

/**
 * El tablero en Excel, con los mismos filtros que había en pantalla.
 *
 * Dos hojas: las solicitudes y sus postulantes. El solicitante exporta solo
 * lo suyo, igual que lo que ve.
 */
export async function GET(request: NextRequest) {
  const { user, gestiona } = await requireRequerimientos();
  const sp = request.nextUrl.searchParams;
  const filtros: FiltrosReq = {
    proyecto: sp.get("proyecto") ?? undefined, cargo: sp.get("cargo") ?? undefined,
    solicitante: sp.get("solicitante") ?? undefined, estado: sp.get("estado") ?? undefined,
    prioridad: sp.get("prioridad") ?? undefined, desde: sp.get("desde") ?? undefined,
    hasta: sp.get("hasta") ?? undefined,
  };
  const hoy = new Date();

  const filas = await db.requerimiento.findMany({
    where: gestiona ? {} : { solicitanteId: user.id },
    select: {
      id: true, numero: true, cargoId: true, proyectoId: true, vacantes: true, fechaRequerida: true,
      solicitanteNombre: true, prioridad: true, estado: true, turno: true, requisitos: true,
      observaciones: true, motivoCierre: true, createdAt: true, contratadoEn: true, cerradoEn: true,
      cargo: { select: { nombre: true } },
      proyecto: { select: { nombre: true } },
      postulantes: {
        orderBy: { createdAt: "asc" },
        select: {
          nombre: true, rut: true, telefono: true, email: true, fechaPostulacion: true, estado: true,
          motivoDescarte: true, aprobadoPorNombre: true, aprobadoEn: true, contratadoEn: true, cvArchivoId: true,
        },
      },
    },
  });
  const seleccion = filtrarRequerimientos(filas, filtros).sort(ordenUrgencia);

  const solicitudes = seleccion.map(r => {
    const cubiertas = vacantesCubiertas(r.postulantes);
    return {
      "N°": codigoReq(r.numero),
      "Cargo": r.cargo.nombre,
      "Proyecto": r.proyecto.nombre,
      "Solicitante": r.solicitanteNombre,
      "Fecha de solicitud": fechaChile(r.createdAt),
      "Fecha requerida": fechaChile(r.fechaRequerida),
      "Días restantes": estaAbierta(r.estado) ? diasHasta(r.fechaRequerida, hoy) : "",
      "Plazo": textoPlazo(r, hoy),
      "Prioridad": prioridadDe(r.prioridad).label,
      "Estado": etiquetaSolicitud(r.estado),
      "Vacantes": r.vacantes,
      "Cubiertas": cubiertas,
      "Postulantes": r.postulantes.length,
      "Turno": r.turno,
      "Requisitos": r.requisitos ?? "",
      "Observaciones": r.observaciones ?? "",
      "Cubierta el": fechaChile(r.contratadoEn),
      "Días de contratación": r.contratadoEn ? Math.round((r.contratadoEn.getTime() - r.createdAt.getTime()) / 86_400_000) : "",
      "Cerrada el": fechaChile(r.cerradoEn),
      "Motivo de cierre": r.motivoCierre ?? "",
    };
  });

  const postulantes = seleccion.flatMap(r => r.postulantes.map(p => ({
    "N°": codigoReq(r.numero),
    "Cargo": r.cargo.nombre,
    "Proyecto": r.proyecto.nombre,
    "Postulante": p.nombre,
    "RUT": p.rut,
    "Teléfono": p.telefono ?? "",
    "Correo": p.email ?? "",
    "Fecha de postulación": fechaChile(p.fechaPostulacion),
    "Estado": etiquetaPostulante(p.estado),
    "Aprobado por": p.aprobadoPorNombre ?? "",
    "Aprobado el": fechaChile(p.aprobadoEn),
    "Contratado el": fechaChile(p.contratadoEn),
    "Motivo de descarte": p.motivoDescarte ?? "",
    "CV": p.cvArchivoId ? "Sí" : "No",
  })));

  const libro = XLSX.utils.book_new();
  const hoja1 = XLSX.utils.json_to_sheet(solicitudes.length > 0 ? solicitudes : [{ "N°": "Sin solicitudes con estos filtros" }]);
  hoja1["!cols"] = [8, 26, 16, 20, 12, 12, 8, 12, 9, 22, 8, 9, 10, 8, 40, 30, 12, 10, 12, 30].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(libro, hoja1, "Solicitudes");
  const hoja2 = XLSX.utils.json_to_sheet(postulantes.length > 0 ? postulantes : [{ "N°": "Sin postulantes" }]);
  hoja2["!cols"] = [8, 26, 16, 28, 13, 14, 26, 12, 22, 20, 12, 12, 34, 5].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(libro, hoja2, "Postulantes");

  const buffer = XLSX.write(libro, { type: "buffer", bookType: "xlsx" });
  const nombreArchivo = `requerimientos-personal-${hoy.toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
    },
  });
}
