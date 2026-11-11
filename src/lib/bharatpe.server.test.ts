import { describe, expect, it } from "vitest";
import { isPaymentSystemDisabledByEnv, validateBharatPeTransactions } from "./bharatpe.server";

describe("validateBharatPeTransactions", () => {
  it("honors the environment kill switch", () => {
    const previous = process.env["PAYMENT_SYSTEM_ENABLED"];
    try {
      process.env["PAYMENT_SYSTEM_ENABLED"] = "false";
      expect(isPaymentSystemDisabledByEnv()).toBe(true);
      process.env["PAYMENT_SYSTEM_ENABLED"] = "0";
      expect(isPaymentSystemDisabledByEnv()).toBe(true);
      process.env["PAYMENT_SYSTEM_ENABLED"] = "true";
      expect(isPaymentSystemDisabledByEnv()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env["PAYMENT_SYSTEM_ENABLED"];
      else process.env["PAYMENT_SYSTEM_ENABLED"] = previous;
    }
  });

  it("accepts an exact successful UTR and amount", () => {
    expect(
      validateBharatPeTransactions(
        {
          data: {
            transactions: [{ bankReferenceNo: "123456789012", amount: "49.00", status: "SUCCESS" }],
          },
        },
        "123456789012",
        49,
      ),
    ).toMatchObject({ ok: true, amount: 49, status: "SUCCESS" });
  });

  it("rejects a transaction with a different amount", () => {
    expect(
      validateBharatPeTransactions(
        {
          data: {
            transactions: [{ bankReferenceNo: "123456789012", amount: 50, status: "SUCCESS" }],
          },
        },
        "123456789012",
        49,
      ),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("does not treat a matching UTR with a pending status as paid", () => {
    expect(
      validateBharatPeTransactions(
        {
          data: {
            transactions: [{ bankReferenceNo: "123456789012", amount: 49, status: "PENDING" }],
          },
        },
        "123456789012",
        49,
      ),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("requires an exact UTR match", () => {
    expect(
      validateBharatPeTransactions(
        {
          data: {
            transactions: [{ bankReferenceNo: "9123456789012", amount: 49, status: "SUCCESS" }],
          },
        },
        "123456789012",
        49,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});
