import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./local-auth-crypto";

describe("local account password hashes", () => {
  it("stores salted hashes and verifies only the matching password", async () => {
    const first = await hashPassword("a-long-password-for-testing");
    const second = await hashPassword("a-long-password-for-testing");

    expect(first).not.toBe(second);
    await expect(verifyPassword("a-long-password-for-testing", first)).resolves.toBe(true);
    await expect(verifyPassword("different-password", first)).resolves.toBe(false);
    await expect(verifyPassword("a-long-password-for-testing", "invalid")).resolves.toBe(false);
  });
});
