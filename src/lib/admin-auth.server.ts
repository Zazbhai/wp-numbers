import { createHash, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { isValidAdminKey } from "./business-lines.server";

export const ADMIN_COOKIE_NAME = "wa_admin_auth";
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function getExpectedAdminToken(): string {
  const secret = process.env["BUSINESS_LINES_ADMIN_KEY"] || "";
  if (!secret) return "";
  return createHash("sha256").update(`wa_admin_session:${secret}`).digest("hex");
}

export function verifyAdminToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = getExpectedAdminToken();
  if (!expected || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function isRequestAdmin(request?: Request | Headers | null): boolean {
  // 1. Check x-admin-key header
  const adminHeader =
    request instanceof Request
      ? request.headers.get("x-admin-key")
      : request instanceof Headers
        ? request.get("x-admin-key")
        : null;

  if (adminHeader && isValidAdminKey(adminHeader)) {
    return true;
  }

  // 2. Check Cookie header from provided Request / Headers
  if (request) {
    const cookieHeader =
      request instanceof Request
        ? request.headers.get("cookie")
        : request instanceof Headers
          ? request.get("cookie")
          : null;

    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE_NAME}=([^;]+)`));
      if (match && match[1] && verifyAdminToken(decodeURIComponent(match[1]))) {
        return true;
      }
    }
  }

  // 3. Fallback to TanStack getCookie (available within server function execution context)
  try {
    const cookieVal = getCookie(ADMIN_COOKIE_NAME);
    if (cookieVal && verifyAdminToken(cookieVal)) {
      return true;
    }
  } catch {
    // Outside request context (e.g. testing)
  }

  return false;
}

export async function setAdminSessionCookie(valid: boolean): Promise<boolean> {
  if (!valid) return false;
  const token = getExpectedAdminToken();
  if (!token) return false;
  try {
    setCookie(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ADMIN_COOKIE_MAX_AGE,
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearAdminSessionCookie(): Promise<void> {
  try {
    deleteCookie(ADMIN_COOKIE_NAME, { path: "/" });
  } catch {
    // Outside request context
  }
}
