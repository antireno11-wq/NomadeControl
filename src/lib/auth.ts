import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "camp_session";
const SESSION_TTL_DAYS = 7;
export type AppRole = "ADMIN" | "OPERADOR";

function sessionExpirationDate() {
  const date = new Date();
  date.setDate(date.getDate() + SESSION_TTL_DAYS);
  return date;
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = sessionExpirationDate();

  await db.session.create({
    data: {
      token,
      userId,
      expiresAt
    }
  });

  cookies().set({
    name: SESSION_COOKIE_NAME,
    value: token,
    expires: expiresAt,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

export async function clearSession() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await db.session.deleteMany({ where: { token } });
  }

  cookies().delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { token },
    include: { user: true }
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { token } });
    cookies().delete(SESSION_COOKIE_NAME);
    return null;
  }

  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireRole(allowed: AppRole[]) {
  const user = await requireUser();

  if (!allowed.includes(user.role as AppRole)) {
    redirect("/dashboard");
  }

  return user;
}
