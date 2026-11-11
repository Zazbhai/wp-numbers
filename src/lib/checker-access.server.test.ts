import { beforeAll, describe, expect, it } from "vitest";
import { isRequestAdmin } from "./admin-auth.server";

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
describe("Checker & Admin Access Control", () => {
  it("denies access to unauthorized callers without admin key or session", () => {
    const unauthenticatedReq = new Request("http://localhost:8080/checker");
    expect(isRequestAdmin(unauthenticatedReq)).toBe(false);
  });

  it("grants access when valid x-admin-key header is provided", () => {
    const adminKey = process.env["BUSINESS_LINES_ADMIN_KEY"]!;
    const adminReq = new Request("http://localhost:8080/checker", {
      headers: { "x-admin-key": adminKey },
    });
    expect(isRequestAdmin(adminReq)).toBe(true);
  });

  it("denies access when invalid x-admin-key header is provided", () => {
    const fakeReq = new Request("http://localhost:8080/checker", {
      headers: { "x-admin-key": "fake-admin-key" },
    });
    expect(isRequestAdmin(fakeReq)).toBe(false);
  });
});
