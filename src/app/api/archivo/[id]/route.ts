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
  const disposicion = `${descargar ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(archivo.originalFilename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

  // Con `url` el archivo vive afuera; hoy son las fotos de checklist que
  // llegan por Google Forms y quedan en Drive. Para descargar se intenta
  // pasarlo por acá, porque la redirección pierde el Content-Disposition.
  // Drive no se lo entrega a un servidor sin sesión de Google (responde 401
  // o una página de login): en ese caso se redirige, que es lo que siempre
  // funcionó para quien tiene acceso desde su navegador.
  if (archivo.url) {
    if (descargar) {
      const remoto = await fetch(archivo.url).catch(() => null);
      const esPaginaDeLogin = remoto?.headers.get("content-type")?.startsWith("text/html") ?? false;
      if (remoto?.ok && remoto.body && !esPaginaDeLogin) {
        return new NextResponse(remoto.body, {
          headers: {
            "Content-Type": archivo.mimeType || "application/octet-stream",
            "Content-Disposition": disposicion,
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
    }
    return NextResponse.redirect(archivo.url);
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
