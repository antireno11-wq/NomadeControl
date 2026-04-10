import { redirect } from "next/navigation";
import { db } from "@/lib/db";

const AUDIT_OWNER_EMAILS = new Set([
  "antireno11@gmail.com",
  "sebastian@nomadechile.cl",
  "sebastian.antireno@nomadechile.cl"
]);

export function canViewAuditLog(email?: string | null) {
  if (!email) return false;
  return AUDIT_OWNER_EMAILS.has(email.trim().toLowerCase());
}

export async function requireAuditOwner(user: { email: string }) {
  if (!canViewAuditLog(user.email)) {
    redirect("/dashboard");
  }
}

export async function logAuditEvent(input: {
  actorUserId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await db.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorName: input.actorName ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null
      }
    });
  } catch {
    // Audit should never block user actions.
  }
}
