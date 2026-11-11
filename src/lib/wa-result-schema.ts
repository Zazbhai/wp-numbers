import { z } from "zod";

export const waResultSchema = z.object({
  phone: z.string().max(32),
  found: z.boolean(),
});