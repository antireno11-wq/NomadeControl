import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * Sirve un archivo de acreditación (documento escaneado o foto del
 * trabajador) para previsualizarlo en el navegador.
 *
 * Requiere sesión: son datos personales bajo la Ley 21.719, no pueden
 * quedar accesibles por URL pública.
 *
 * `?download=1` fuerza la descarga en vez de mostrarlo inline.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const archivo = await db.archivoAcreditacion.findUnique({
    where: { id: params.id },
    select: { contenido: true, mimeType: true, originalFilename: true, url: true },
  });

  if (!archivo) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  // Fase C: si ya está en R2, redirigimos en vez de servir bytes
  if (archivo.url) {
    return NextResponse.redirect(archivo.url);
  }

  if (!archivo.contenido) {
    return NextResponse.json({ error: "El archivo no tiene contenido" }, { status: 404 });
  }

  const descargar = req.nextUrl.searchParams.get("download") === "1";
  const nombreSeguro = archivo.originalFilename.replace(/["\\]/g, "");

  return new NextResponse(new Uint8Array(archivo.contenido), {
    headers: {
      "Content-Type": archivo.mimeType || "application/octet-stream",
      "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename="${nombreSeguro}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
