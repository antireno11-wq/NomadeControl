import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createSession, defaultRouteForRole } from "@/lib/auth";
import { db } from "@/lib/db";

const GOOGLE_STATE_COOKIE = "google_oauth_state";

function appUrl() {
  return process.env.APP_URL ?? "http://localhost:3000";
}

function googleRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI ?? `${appUrl()}/api/auth/google/callback`;
}

function fail(code: string) {
  return NextResponse.redirect(`${appUrl()}/login?error=${code}`);
}

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail("google_not_configured");
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = cookies().get(GOOGLE_STATE_COOKIE)?.value;
  cookies().delete(GOOGLE_STATE_COOKIE);

  if (!code || !state || !stateCookie || state !== stateCookie) {
    return fail("google_state_invalid");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code"
    })
  });

  if (!tokenResponse.ok) {
    return fail("google_token_failed");
  }

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    return fail("google_token_missing");
  }

  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });

  if (!userInfoResponse.ok) {
    return fail("google_userinfo_failed");
  }

  const userInfo = (await userInfoResponse.json()) as { email?: string; email_verified?: boolean };
  const email = userInfo.email?.toLowerCase();
  if (!email || !userInfo.email_verified) {
    return fail("google_email_not_verified");
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return fail("google_user_not_authorized");
  }

  await createSession(user.id);
  return NextResponse.redirect(`${appUrl()}${defaultRouteForRole(user.role)}`);
}
