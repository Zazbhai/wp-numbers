import { describe, expect, it } from "vitest";
import { sessionReportSchema, shouldQueueLogout } from "./wa-session";

describe("WhatsApp logout alerts", () => {
  it("alerts when a logged-in session logs out", () => {
    expect(shouldQueueLogout("connected", "logged_out")).toBe(true);
  });
  it("does not repeat the alert on subsequent logged-out checks", () => {
    expect(shouldQueueLogout("logged_out", "logged_out")).toBe(false);
  });
  it("does not call an idle or failed connection a logout", () => {
    expect(shouldQueueLogout(null, "logged_out")).toBe(false);
    expect(sessionReportSchema.safeParse({ sessionId: "123", state: "error" }).success).toBe(false);
  });
});