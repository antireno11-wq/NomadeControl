import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendTareasVencidasEmail } from "@/lib/mailer";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const received = request.headers.get("x-cron-secret") ?? request.nextUrl.searchParams.get("secret");

  if (!secret || received !== secret) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const now = new Date();

  const tareasVencidas = await db.tarea.findMany({
    where: {
      estado: { notIn: ["completada", "cancelada"] },
      fechaCierre: { lt: now },
    },
    orderBy: { fechaCierre: "asc" },
  });

  if (tareasVencidas.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "No hay tareas vencidas." });
  }

  const recipients = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ["ADMINISTRADOR", "ADMIN", "ADMIN_LIMITADO", "SUPERVISOR", "OFICINA"] },
      email: { not: "" },
    },
    select: { email: true },
  });

  const emails = recipients.map(u => u.email);

  if (emails.length === 0) {
    return NextResponse.json({ error: "No hay destinatarios." }, { status: 400 });
  }

  const tareas = tareasVencidas.map(t => ({
    descripcion: t.descripcion,
    responsable: t.responsable,
    prioridad: t.prioridad,
    diasAtraso: Math.floor((now.getTime() - (t.fechaCierre as Date).getTime()) / 86400000),
  }));

  await sendTareasVencidasEmail({ to: emails, tareas });

  return NextResponse.json({ ok: true, count: tareas.length, tareas });
}
