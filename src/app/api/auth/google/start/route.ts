import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const GOOGLE_STATE_COOKIE = "google_oauth_state";

function appUrl() {
  return process.env.APP_URL ?? "http://localhost:3000";
}

function googleRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI ?? `${appUrl()}/api/auth/google/callback`;
}

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(`${appUrl()}/login?error=google_not_configured`);
  }

  const state = crypto.randomBytes(24).toString("hex");

  cookies().set({
    name: GOOGLE_STATE_COOKIE,
    value: state,
    maxAge: 60 * 10,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", googleRedirectUri());
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(authUrl.toString());
}
