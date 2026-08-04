import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

/**
 * Borra TODOS los trabajadores y todo lo que cuelga de ellos, para
 * empezar de cero. Irreversible.
 *
 * En cascada se van: documentos de acreditación, adjuntos, alertas
 * enviadas, días de turno, cierres de contrato y documentos adicionales.
 * Las entregas de EPP e inducciones quedan huérfanas (SetNull), no se
 * borran.
 *
 * NO toca el catálogo de tipos de documento ni los campamentos.
 *
 * Uso:
 *   GET  /api/admin/reset-trabajadores                    → cuenta qué se borraría
 *   POST /api/admin/reset-trabajadores?confirmar=BORRAR   → ejecuta
 *
 * El parámetro `confirmar=BORRAR` es a propósito: evita que una visita
 * accidental a la URL destruya la dotación.
 */

async function esAdmin(): Promise<boolean> {
  const user = await getCurrentUser().catch(() => null);
  return Boolean(user && isAdminRole(user.role));
}

export async function GET() {
  if (!(await esAdmin())) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 401 });
  }

  const [trabajadores, documentos, adjuntos, alertas, turnos, cierres] = await Promise.all([
    db.staffMember.count(),
    db.documentoAcreditacion.count(),
    db.documentoTrabajador.count(),
    db.alertaDocumento.count(),
    db.staffShiftDay.count(),
    db.cierreContrato.count(),
  ]);

  return NextResponse.json({
    ok: true,
    modo: "simulación",
    seBorraria: { trabajadores, documentos, adjuntos, alertas, turnos, cierres },
    noSeToca: ["Catálogo de tipos de documento", "Campamentos", "Usuarios", "Vehículos"],
    paraEjecutar: "POST a esta misma URL con ?confirmar=BORRAR",
    advertencia: "Es irreversible. No hay papelera ni deshacer.",
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 401 });
  }

  if (req.nextUrl.searchParams.get("confirmar") !== "BORRAR") {
    return NextResponse.json({
      error: "Falta confirmación",
      comoHacerlo: "Agregá ?confirmar=BORRAR a la URL",
    }, { status: 400 });
  }

  const antes = await db.staffMember.count();

  // El orden importa aunque casi todo sea cascade: borramos primero lo
  // que referencia trabajadores para que ningún FK quede colgando.
  await db.alertaDocumento.deleteMany({});
  await db.documentoAcreditacion.deleteMany({});
  await db.documentoTrabajador.deleteMany({});
  await db.documentoAdicional.deleteMany({});
  await db.staffShiftDay.deleteMany({});
  await db.cierreContrato.deleteMany({});
  const res = await db.staffMember.deleteMany({});

  await logAuditEvent({
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: "RESET_TRABAJADORES",
    entityType: "staffMember",
    summary: `Borró toda la dotación: ${res.count} trabajadores`,
    metadata: { antes, borrados: res.count },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    borrados: res.count,
    mensaje: "Dotación borrada. El catálogo de tipos de documento quedó intacto.",
  });
}
