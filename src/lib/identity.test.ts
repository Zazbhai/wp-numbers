import { describe, it, expect } from "vitest";
import { parseLookup } from "./identity";

describe("parseLookup", () => {
  it("normalizes email to lowercase", () => {
    expect(parseLookup("  Ravi@Example.COM ")).toEqual({ kind: "email", value: "ravi@example.com" });
  });
  it("adds +91 to 10-digit Indian numbers", () => {
    expect(parseLookup("98765 43210")).toEqual({ kind: "phone", value: "+919876543210" });
  });
  it("strips leading 0 from 11-digit numbers", () => {
    expect(parseLookup("09876543210")).toEqual({ kind: "phone", value: "+919876543210" });
  });
  it("keeps +91 numbers", () => {
    expect(parseLookup("+91-9876543210")).toEqual({ kind: "phone", value: "+919876543210" });
  });
  it("rejects junk", () => {
    expect(parseLookup("hello")).toBeNull();
    expect(parseLookup("abc@")).toBeNull();
  });
});
