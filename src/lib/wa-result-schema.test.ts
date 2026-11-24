import { describe, expect, it } from "vitest";
import { waResultSchema } from "./wa-result-schema";

describe("WhatsApp automation results", () => {
  it("accepts a confirmed match for Telegram forwarding", () => {
    expect(
      waResultSchema.parse({
        phone: "+918000858534",
        found: true,
        claimId: "9f1bd72f-3608-4bbb-9cfe-2b64fdbf97b1",
      }).found,
    ).toBe(true);
  });
  it("accepts confirmed absence for skipping", () => {
    expect(
      waResultSchema.parse({
        phone: "+918000858534",
        found: false,
        claimId: "9f1bd72f-3608-4bbb-9cfe-2b64fdbf97b1",
      }).found,
    ).toBe(false);
  });
  it("does not convert an unknown result into a skip", () => {
    expect(waResultSchema.safeParse({ phone: "+918000858534" }).success).toBe(false);
    expect(
      waResultSchema.safeParse({
        phone: "+918000858534",
        found: "false",
        claimId: "9f1bd72f-3608-4bbb-9cfe-2b64fdbf97b1",
      }).success,
    ).toBe(false);
  });
});
