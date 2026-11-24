import { z } from "zod";

export const sessionReportSchema = z.object({
  sessionId: z.string().uuid(),
  state: z.enum(["connected", "logged_out"]),
});

export function shouldQueueLogout(previous: string | null, next: string) {
  return previous === "connected" && next === "logged_out";
}

export function getWhatsAppCheckTransition(
  previous: "pending" | "pending_verify",
  found: boolean,
): "pending_verify" | "available" | "skipped" {
  if (!found) return "skipped";
  return previous === "pending" ? "pending_verify" : "available";
}
