import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  const doc = await db.documento.findUnique({ where: { id: params.id } });
  if (!doc) {
    return new NextResponse("Documento no encontrado", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", doc.mimeType ?? "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(doc.originalFilename)}"`
  );
  if (doc.fileSize) {
    headers.set("Content-Length", String(doc.fileSize));
  }

  return new NextResponse(doc.contenido.buffer as ArrayBuffer, { headers });
}
