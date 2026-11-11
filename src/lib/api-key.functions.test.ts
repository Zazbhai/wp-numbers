import { describe, it, expect, beforeAll } from "vitest";
import {
  getOrCreateApiKeyCore,
  generateNewApiKeyCore,
  topUpApiKeyBalanceCore,
} from "./api-key.server";

beforeAll(() => {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // ignore if not supported
  }
});

describe("api-key functions", () => {
  it("retrieves or creates an API key with positive balance", async () => {
    const res = await getOrCreateApiKeyCore();
    expect(res.ok).toBe(true);
    if (res.ok && res.apiKey) {
      expect(res.apiKey.key).toMatch(/^sk_live_[a-f0-9]{32}$/);
      expect(res.apiKey.maskedKey).toContain("••••••••••••••••");
      expect(res.apiKey.balance).toBeGreaterThanOrEqual(0);
      expect(res.apiKey.balanceFormatted).toMatch(/^₹\d+(\.\d{2})?$/);
    }
  });

  it("tops up balance on an API key", async () => {
    const res = await getOrCreateApiKeyCore();
    expect(res.ok).toBe(true);
    if (res.ok && res.apiKey) {
      const initialBalance = res.apiKey.balance;
      const topUp = await topUpApiKeyBalanceCore({
        key: res.apiKey.key,
        amount: 25,
      });
      expect(topUp.ok).toBe(true);
      if (topUp.ok && topUp.newBalance !== undefined) {
        expect(topUp.newBalance).toBe(initialBalance + 25);
      }
    }
  });

  it("generates a new unique live key with starter credits", async () => {
    const gen = await generateNewApiKeyCore({
      email: "bot_tester@example.com",
      label: "Vitest Bot Key",
    });
    expect(gen.ok).toBe(true);
    if (gen.ok && gen.apiKey) {
      expect(gen.apiKey.key).toMatch(/^sk_live_[a-f0-9]{32}$/);
      expect(gen.apiKey.balance).toBe(200);
      expect(gen.apiKey.label).toBe("Vitest Bot Key");
      expect(gen.apiKey.ownerEmail).toBe("bot_tester@example.com");
    }
  });
});
