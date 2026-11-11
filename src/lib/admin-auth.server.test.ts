import { beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_COOKIE_NAME,
  getExpectedAdminToken,
  isRequestAdmin,
  verifyAdminToken,
} from "./admin-auth.server";

beforeAll(() => {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // ignore
  }
  if (!process.env["BUSINESS_LINES_ADMIN_KEY"]) {
    process.env["BUSINESS_LINES_ADMIN_KEY"] = "nigga";
  }
});

describe("admin-auth.server", () => {
  it("computes a deterministic expected token based on BUSINESS_LINES_ADMIN_KEY", () => {
    const token = getExpectedAdminToken();
    expect(token).toBeDefined();
    expect(token.length).toBe(64); // sha256 hex
  });

  it("verifies expected token correctly and rejects forged tokens", () => {
    const token = getExpectedAdminToken();
    expect(verifyAdminToken(token)).toBe(true);
    expect(verifyAdminToken("invalid-token-1234567890")).toBe(false);
    expect(verifyAdminToken("")).toBe(false);
    expect(verifyAdminToken(null)).toBe(false);
  });

  it("authenticates requests with valid x-admin-key header", () => {
    const validKey = process.env["BUSINESS_LINES_ADMIN_KEY"] || "nigga";
    const req = new Request("http://localhost:8080/checker", {
      headers: { "x-admin-key": validKey },
    });
    expect(isRequestAdmin(req)).toBe(true);

    const invalidReq = new Request("http://localhost:8080/checker", {
      headers: { "x-admin-key": "wrong-key" },
    });
    expect(isRequestAdmin(invalidReq)).toBe(false);
  });

  it("authenticates requests with valid wa_admin_auth cookie", () => {
    const token = getExpectedAdminToken();
    const req = new Request("http://localhost:8080/checker", {
      headers: { cookie: `${ADMIN_COOKIE_NAME}=${token}; other=value` },
    });
    expect(isRequestAdmin(req)).toBe(true);

    const invalidCookieReq = new Request("http://localhost:8080/checker", {
      headers: { cookie: `${ADMIN_COOKIE_NAME}=bad-token` },
    });
    expect(isRequestAdmin(invalidCookieReq)).toBe(false);
  });

  it("rejects unauthenticated requests", () => {
    const req = new Request("http://localhost:8080/checker");
    expect(isRequestAdmin(req)).toBe(false);
    expect(isRequestAdmin(null)).toBe(false);
  });
});
