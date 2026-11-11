import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const unlockSchema = z.object({
  adminKey: z.string().min(1, "Admin key is required"),
});

export const checkAdminAccess = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { isRequestAdmin } = await import("./admin-auth.server");
    return { isAdmin: isRequestAdmin() };
  } catch (error) {
    console.error("[checkAdminAccess error]:", error);
    return { isAdmin: false };
  }
});

export const unlockAdminWithKey = createServerFn({ method: "POST" })
  .validator((data: unknown) => unlockSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      const { isValidAdminKey } = await import("./business-lines.server");
      const { setAdminSessionCookie } = await import("./admin-auth.server");

      const valid = isValidAdminKey(data.adminKey);
      if (!valid) {
        return { ok: false as const, error: "Incorrect admin key." };
      }

      await setAdminSessionCookie(true);
      return { ok: true as const };
    } catch (error) {
      console.error("[unlockAdminWithKey error]:", error);
      return { ok: false as const, error: "Failed to unlock admin session." };
    }
  });

export const lockAdminSession = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { clearAdminSessionCookie } = await import("./admin-auth.server");
    await clearAdminSessionCookie();
    return { ok: true as const };
  } catch (error) {
    console.error("[lockAdminSession error]:", error);
    return { ok: true as const };
  }
});

