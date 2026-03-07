import { NextResponse } from "next/server";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  await requireRole(ADMIN_ROLES);

  const reports = await db.dailyReport.findMany({
    include: { camp: true, createdBy: true },
    orderBy: [{ date: "desc" }, { camp: { name: "asc" } }]
  });

  return NextResponse.json(reports);
}
