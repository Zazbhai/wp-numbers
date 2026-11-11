export type Lookup = { kind: "email"; value: string } | { kind: "phone"; value: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = "91" + digits;
  if (digits.length < 11 || digits.length > 15) return null;
  return "+" + digits;
}

export function normalizeEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

export function parseLookup(text: string): Lookup {
  const t = text.trim();
  if (t.includes("@")) {
    const e = normalizeEmail(t);
    return e ? { kind: "email", value: e } : null;
  }
  const p = normalizePhone(t);
  return p ? { kind: "phone", value: p } : null;
}
