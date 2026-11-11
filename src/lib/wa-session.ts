import { z } from "zod";

export const sessionReportSchema = z.object({
  sessionId: z.string().uuid(),
  state: z.enum(["connected", "logged_out"]),
});

export function shouldQueueLogout(previous: string | null, next: string) {
  return previous === "connected" && next === "logged_out";
}