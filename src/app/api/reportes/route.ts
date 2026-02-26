import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  await requireRole(["ADMIN"]);

  const reports = await db.dailyReport.findMany({
    include: { camp: true, createdBy: true },
    orderBy: [{ date: "desc" }, { camp: { name: "asc" } }]
  });

  return NextResponse.json(reports);
}
