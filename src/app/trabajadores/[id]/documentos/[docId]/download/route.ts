import { NextResponse } from "next/server";
import { requireRole, OPERATION_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: { id: string; docId: string } }) {
  await requireRole(OPERATION_ROLES);
  const doc = await db.documentoTrabajador.findUnique({ where: { id: params.docId, staffMemberId: params.id } });
  if (!doc || !doc.contenido) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(doc.contenido as unknown as BodyInit, {
    headers: {
      "Content-Type": doc.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${doc.originalFilename ?? doc.nombre}"`,
    },
  });
}
