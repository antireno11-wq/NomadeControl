import { NextRequest, NextResponse } from "next/server";
import { ADMIN_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendMissingDailyInputsAlertEmail } from "@/lib/mailer";
import { formatDisplayDate, normalizeDateOnly, toInputDateValue } from "@/lib/report-utils";

function yesterdayDateInSantiago() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const todayParts = formatter.formatToParts(new Date()).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  const today = new Date(Date.UTC(Number(todayParts.year), Number(todayParts.month) - 1, Number(todayParts.day)));
  today.setUTCDate(today.getUTCDate() - 1);
  return today;
}

function parseTargetDate(raw: string | null) {
  if (!raw) {
    return yesterdayDateInSantiago();
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }

  return normalizeDateOnly(raw);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const receivedSecret = request.headers.get("x-cron-secret") ?? request.nextUrl.searchParams.get("secret");

  if (!secret || receivedSecret !== secret) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const targetDate = parseTargetDate(request.nextUrl.searchParams.get("date"));
  if (!targetDate) {
    return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  }

  const targetDateLabel = formatDisplayDate(targetDate);
  const targetDateKey = toInputDateValue(targetDate);
  const alertKind = "missing-daily-inputs";

  const alreadySent = await db.alertDelivery.findUnique({
    where: {
      kind_targetDate: {
        kind: alertKind,
        targetDate
      }
    }
  });

  if (alreadySent) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Alerta ya enviada para esa fecha.",
      targetDate: targetDateKey
    });
  }

  const [camps, reports, taskControls, adminUsers] = await Promise.all([
    db.camp.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    }),
    db.dailyReport.findMany({
      where: { date: targetDate },
      select: { campId: true }
    }),
    db.dailyTaskControl.findMany({
      where: { date: targetDate },
      select: { campId: true }
    }),
    db.user.findMany({
      where: {
        isActive: true,
        role: { in: ADMIN_ROLES }
      },
      orderBy: { email: "asc" },
      select: { id: true, email: true }
    })
  ]);

  const envRecipients = (process.env.ALERT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const recipients = envRecipients.length > 0 ? envRecipients : adminUsers.map((user) => user.email);

  const reportCampIds = new Set(reports.map((row) => row.campId));
  const taskCampIds = new Set(taskControls.map((row) => row.campId));
  const missingCamps = camps
    .map((camp) => ({
      campName: camp.name,
      missingReport: !reportCampIds.has(camp.id),
      missingTasks: !taskCampIds.has(camp.id)
    }))
    .filter((camp) => camp.missingReport || camp.missingTasks);

  if (missingCamps.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "No faltan cargas para esa fecha.",
      targetDate: targetDateKey
    });
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: "No hay administradores activos para recibir la alerta." }, { status: 400 });
  }

  await sendMissingDailyInputsAlertEmail({
    to: recipients,
    targetDateLabel,
    missingCamps
  });

  await db.alertDelivery.create({
    data: {
      kind: alertKind,
      targetDate,
      recipientId: adminUsers[0]?.id ?? null,
      status: "SENT",
      payload: JSON.stringify({
        recipients,
        missingCamps
      })
    }
  });

  return NextResponse.json({
    ok: true,
    targetDate: targetDateKey,
    recipients,
    missingCamps
  });
}
