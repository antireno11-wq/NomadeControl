import { NextResponse } from "next/server";
import { requireRole, HSEC_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: { docId: string } }) {
  await requireRole(HSEC_ROLES);
  const doc = await db.documentoHSEC.findUnique({ where: { id: params.docId } });
  if (!doc || !doc.contenido) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(doc.contenido.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": doc.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${doc.originalFilename ?? doc.nombre}"`,
    },
  });
}
