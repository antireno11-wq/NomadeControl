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

  const descargar = req.nextUrl.searchParams.get("download") === "1";
  // El nombre va dos veces: `filename` en ASCII para los navegadores viejos y
  // `filename*` en UTF-8, que es el que conserva "Cédula" o "Muñoz". Sin él,
  // el archivo bajaba con el nombre mutilado o como "archivo".
  const ascii = archivo.originalFilename.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "documento";
  const disposicion = `${descargar ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(archivo.originalFilename)}`;

  // Fase C: si ya está en R2, redirigimos en vez de servir bytes. Para
  // descargar no sirve: la redirección pierde el Content-Disposition y el
  // navegador lo abre en vez de bajarlo, así que en ese caso se pasa por acá.
  if (archivo.url) {
    if (!descargar) return NextResponse.redirect(archivo.url);
    const remoto = await fetch(archivo.url);
    if (!remoto.ok || !remoto.body) {
      return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 502 });
    }
    return new NextResponse(remoto.body, {
      headers: {
        "Content-Type": archivo.mimeType || "application/octet-stream",
        "Content-Disposition": disposicion,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  if (!archivo.contenido) {
    return NextResponse.json({ error: "El archivo no tiene contenido" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(archivo.contenido), {
    headers: {
      "Content-Type": archivo.mimeType || "application/octet-stream",
      "Content-Disposition": disposicion,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
