import { describe, expect, it } from "vitest";
import { waResultSchema } from "./wa-result-schema";

describe("WhatsApp automation results", () => {
  it("accepts a confirmed match for Telegram forwarding", () => {
    expect(waResultSchema.parse({ phone: "+918000858534", found: true }).found).toBe(true);
  });
  it("accepts confirmed absence for skipping", () => {
    expect(waResultSchema.parse({ phone: "+918000858534", found: false }).found).toBe(false);
  });
  it("does not convert an unknown result into a skip", () => {
    expect(waResultSchema.safeParse({ phone: "+918000858534" }).success).toBe(false);
    expect(waResultSchema.safeParse({ phone: "+918000858534", found: "false" }).success).toBe(false);
  });
});