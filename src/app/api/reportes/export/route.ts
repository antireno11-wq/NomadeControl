import { NextRequest, NextResponse } from "next/server";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";

function parseDateOnly(raw: string | null) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const [year, month, day] = raw.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function csvEscape(value: string | number) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function xmlEscape(value: string | number) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET(request: NextRequest) {
  await requireRole(ADMIN_ROLES);

  const formatRaw = request.nextUrl.searchParams.get("format");
  const format = formatRaw === "xls" ? "xls" : "csv";
  const campId = request.nextUrl.searchParams.get("campId");
  const from = parseDateOnly(request.nextUrl.searchParams.get("from"));
  const to = parseDateOnly(request.nextUrl.searchParams.get("to"));

  const where: {
    campId?: string;
    date?: { gte?: Date; lte?: Date };
  } = {};

  if (campId && campId !== "general") {
    where.campId = campId;
  }

  if (from || to) {
    where.date = {};
    if (from) where.date.gte = from;
    if (to) where.date.lte = to;
  }

  const reports = await db.dailyReport.findMany({
    where,
    include: { camp: true, createdBy: true },
    orderBy: [{ date: "asc" }, { camp: { name: "asc" } }]
  });

  const headers = [
    "Fecha",
    "Campamento",
    "Personas",
    "Desayuno",
    "Almuerzo",
    "Cena",
    "Colacion Simple",
    "Colacion Reemplazo",
    "Botellas Agua",
    "Alojamientos",
    "Lectura Medidor",
    "Agua Litros",
    "Combustible Litros",
    "Basura %",
    "Cloro",
    "pH",
    "Notas",
    "Operador"
  ];

  const rows = reports.map((report) => [
    toInputDateValue(report.date),
    report.camp.name,
    report.peopleCount,
    report.breakfastCount,
    report.lunchCount,
    report.dinnerCount,
    report.snackSimpleCount,
    report.snackReplacementCount,
    report.waterBottleCount,
    report.lodgingCount,
    report.meterReading.toFixed(2),
    report.waterLiters,
    report.fuelLiters,
    report.wasteFillPercent,
    report.chlorineLevel.toFixed(2),
    report.phLevel.toFixed(2),
    report.notes ?? "",
    report.createdBy.name
  ]);

  const stamp = toInputDateValue(new Date());

  if (format === "xls") {
    const htmlRows = rows
      .map((row) => `<tr>${row.map((col) => `<td>${xmlEscape(col)}</td>`).join("")}</tr>`)
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" /></head><body><table border="1"><thead><tr>${headers
      .map((header) => `<th>${xmlEscape(header)}</th>`)
      .join("")}</tr></thead><tbody>${htmlRows}</tbody></table></body></html>`;

    return new NextResponse(`\uFEFF${html}`, {
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="reportes-campamentos-${stamp}.xls"`
      }
    });
  }

  const csv = [headers, ...rows].map((line) => line.map((item) => csvEscape(item)).join(",")).join("\n");
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reportes-campamentos-${stamp}.csv"`
    }
  });
}
