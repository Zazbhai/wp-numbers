import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizeEmail, normalizePhone } from "./identity";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().max(255),
  phone: z.string().trim().max(20),
});

export const registerUser = createServerFn({ method: "POST" })
  .validator((d: unknown) => schema.parse(d))
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const phone = normalizePhone(data.phone);
    if (!email) return { ok: false as const, error: "Email sahi nahi hai" };
    if (!phone) return { ok: false as const, error: "Phone number sahi nahi hai" };

    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      await db.collection("registered_users").insertOne({
        name: data.name,
        email,
        phone,
        created_at: new Date(),
      });
      return { ok: true as const };
    } catch (error: any) {
      if (error?.code === 11000) {
        return { ok: false as const, error: "Ye email ya phone pehle se registered hai" };
      }
      console.error("[registerUser error]:", error);
      return { ok: false as const, error: "Kuch galat ho gaya, dobara try karein" };
    }
  });
