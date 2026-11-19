import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSmsProviderConfig, clearSmsProviderConfigCache } from "./furysms.server";

describe("SMS Provider Settings", () => {
  beforeEach(() => {
    clearSmsProviderConfigCache();
  });

  it("returns default values from environment or fallback defaults", async () => {
    const config = await getSmsProviderConfig(true);
    expect(config.baseUrl).toBeTruthy();
    expect(config.serviceId).toBe("boyaah");
    expect(config.countryId).toBe("22");
  });

  it("caches config until cleared", async () => {
    const config1 = await getSmsProviderConfig();
    const config2 = await getSmsProviderConfig();
    expect(config1).toEqual(config2);
  });
});
