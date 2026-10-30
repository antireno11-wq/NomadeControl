import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole, normalizeRole, parseModulePermissions } from "@/lib/auth";

/**
 * CV de un postulante.
 *
 * No pasa por /api/archivo, que entrega cualquier archivo a cualquier sesión:
 * un CV trae datos personales de alguien que todavía no trabaja en Nómade, y
 * solo lo ve quien puede ver la solicitud — RRHH, gerencia y quien la pidió.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const postulante = await db.postulante.findUnique({
    where: { id: params.id },
    select: {
      nombre: true,
      requerimiento: { select: { solicitanteId: true } },
      cvArchivo: { select: { contenido: true, mimeType: true, originalFilename: true } },
    },
  });
  if (!postulante?.cvArchivo?.contenido) {
    return NextResponse.json({ error: "CV no encontrado" }, { status: 404 });
  }

  const rol = normalizeRole(user.role);
  const permisos = parseModulePermissions(user.modulePermissions);
  const puede =
    isAdminRole(user.role) ||
    (rol === "OPERATIVO" && permisos.includes("reclutamiento")) ||
    (rol === "OPERATIVO" && permisos.includes("requerimientos") && postulante.requerimiento.solicitanteId === user.id);
  if (!puede) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const descargar = req.nextUrl.searchParams.get("download") === "1";
  const nombre = postulante.cvArchivo.originalFilename || `CV ${postulante.nombre}.pdf`;
  const ascii = nombre.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "cv.pdf";
  const disposicion = `${descargar ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

  return new NextResponse(new Uint8Array(postulante.cvArchivo.contenido), {
    headers: {
      "Content-Type": postulante.cvArchivo.mimeType || "application/pdf",
      "Content-Disposition": disposicion,
      "Cache-Control": "private, no-store",
    },
  });
}
