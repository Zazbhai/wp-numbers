import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface ApiKeyItem {
  key: string;
  maskedKey: string;
  label: string;
  balance: number;
  balanceFormatted: string;
  unlimited?: boolean;
  ownerEmail: string;
  createdAt: string;
  disabled: boolean;
}

const keyLookupSchema = z.object({
  storedKey: z.string().optional(),
  email: z.string().email().optional(),
});

export const getOrCreateApiKey = createServerFn({ method: "POST" })
  .validator((data: unknown) => keyLookupSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    let sessionEmail: string | undefined;
    try {
      const { getLocalSession } = await import("@/lib/local-auth.server");
      const session = await getLocalSession();
      sessionEmail = session?.email;
    } catch {
      // ignore outside request context
    }
    const { getOrCreateApiKeyCore } = await import("./api-key.server");
    return getOrCreateApiKeyCore({
      storedKey: data.storedKey,
      email: sessionEmail || data.email,
    });
  });

const generateKeySchema = z.object({
  email: z.string().email().optional(),
  label: z.string().max(60).optional(),
});

export const generateNewApiKey = createServerFn({ method: "POST" })
  .validator((data: unknown) => generateKeySchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    let sessionEmail: string | undefined;
    try {
      const { getLocalSession } = await import("@/lib/local-auth.server");
      const session = await getLocalSession();
      sessionEmail = session?.email;
    } catch {
      // ignore outside request context
    }
    const { generateNewApiKeyCore } = await import("./api-key.server");
    return generateNewApiKeyCore({
      email: sessionEmail || data.email,
      label: data.label,
    });
  });

const topUpSchema = z.object({
  key: z.string().min(10),
  amount: z.number().min(1).max(10000).default(100),
});

export const topUpApiKeyBalance = createServerFn({ method: "POST" })
  .validator((data: unknown) => topUpSchema.parse(data))
  .handler(async ({ data }) => {
    const { topUpApiKeyBalanceCore } = await import("./api-key.server");
    return topUpApiKeyBalanceCore(data);
  });
