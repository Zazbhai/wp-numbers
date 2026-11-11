import { createFileRoute, Link } from "@tanstack/react-router";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  checkAdminAccess,
  lockAdminSession,
  unlockAdminWithKey,
} from "@/lib/admin-auth.functions";

export const Route = createFileRoute("/link")({
  head: () => ({
    meta: [
      { title: "WhatsApp Link — Register Checker" },
      { name: "description", content: "Number daal kar WhatsApp linking code paayein aur WhatsApp Web connect karein." },
      { property: "og:title", content: "WhatsApp Link" },
      { property: "og:description", content: "Number se WhatsApp linking code paayein." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LinkPage,
});

type Status = { slot: number; state: string; phone?: string; code?: string; qr?: string; error?: string };

const LABEL: Record<string, string> = {
  idle: "Link nahi hai",
  starting: "Code aa raha hai...",
  code: "Code ready",
  qr: "QR scan karein",
  connected: "Connected — check chal raha hai",
  error: "Logout / error",
};

function LinkPage() {
  const [adminReady, setAdminReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [slots, setSlots] = useState<Status[]>([]);
  const [max, setMax] = useState(5);
  const [slot, setSlot] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let mounted = true;
    checkAdminAccess().then(({ isAdmin: adminStatus }) => {
      if (!mounted) return;
      setIsAdmin(adminStatus);
      setAdminReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function handleUnlockAdmin(e: FormEvent) {
    e.preventDefault();
    if (!adminKeyInput.trim()) return;
    setUnlocking(true);
    setAdminError("");
    try {
      const res = await unlockAdminWithKey({ data: { adminKey: adminKeyInput.trim() } });
      if (res.ok) {
        setIsAdmin(true);
        setAdminKeyInput("");
      } else {
        setAdminError(res.error || "Incorrect admin key");
      }
    } catch {
      setAdminError("Unable to verify admin key");
    } finally {
      setUnlocking(false);
    }
  }

  async function handleLockAdmin() {
    try {
      await lockAdminSession();
    } finally {
      setIsAdmin(false);
      setSlots([]);
    }
  }

  useEffect(() => {
    if (!adminReady || !isAdmin) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/public/wa-link", { cache: "no-store" });
        const data = await res.json();
        if (!stop) {
          setSlots(data.slots ?? []);
          setMax(data.max ?? 5);
        }
      } catch {
        /* ignore */
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [adminReady, isAdmin]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const phone = String(new FormData(e.currentTarget).get("phone") ?? "");
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/public/wa-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, slot }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !data?.ok) setMsg(data?.error ?? "Kuch gadbad hui, dobara try karein");
  }

  const input = "w-full rounded-lg border bg-card px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring";
  const current = slots.find((s) => s.slot === slot);

  if (!adminReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0d1412] px-5 text-sm text-[#8fa89e]">
        Verifying administrator access...
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0d1412] px-5 py-12 text-[#e8f0ec]">
        <section className="w-full max-w-md rounded-xl border border-[#22352f] bg-[#131f1c] p-6 shadow-2xl">
          <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
            <ShieldAlert className="size-5" />
          </div>
          <h1 className="mt-4 text-xl font-bold">Admin Access Required</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-[#8fa89e]">
            WhatsApp session linking is restricted to system administrators. Regular users can browse available WhatsApp numbers in the Marketplace.
          </p>
          <form onSubmit={handleUnlockAdmin} className="mt-5 space-y-4">
            <div>
              <label className="text-xs font-semibold text-[#8fa89e]">Admin Key</label>
              <input
                type="password"
                value={adminKeyInput}
                onChange={(e) => setAdminKeyInput(e.target.value)}
                placeholder="••••••••••••"
                className="mt-1.5 w-full rounded-md border border-[#2a4038] bg-[#0d1412] px-3 py-2 font-mono text-sm text-[#e8f0ec] outline-none focus:border-amber-400"
                autoFocus
              />
            </div>
            {adminError && <p className="text-xs text-rose-400">{adminError}</p>}
            <button
              type="submit"
              disabled={unlocking || !adminKeyInput.trim()}
              className="inline-flex h-9 w-full items-center justify-center rounded-md bg-amber-600 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:opacity-50"
            >
              {unlocking ? "Verifying..." : "Unlock Linker"}
            </button>
          </form>
          <div className="mt-6 border-t border-[#22352f] pt-4 text-center">
            <Link
              to="/numbers"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8fa89e] transition hover:text-[#e8f0ec]"
            >
              ← Return to Numbers Marketplace
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-5 py-14">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          <Link to="/numbers" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            ← Marketplace
          </Link>
          <span className="text-xs text-muted-foreground">|</span>
          <Link to="/checker" className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Checker Dashboard
          </Link>
          <Link to="/numbers/admin" className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Admin Panel
          </Link>
        </div>
        <button
          onClick={handleLockAdmin}
          title="Lock admin session"
          aria-label="Lock admin session"
          className="flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <LockKeyhole className="size-3.5" />
          <span>Lock</span>
        </button>
      </div>
      <h1 className="mt-6 text-3xl font-bold">WhatsApp Link</h1>
      <p className="mt-2 text-muted-foreground">
        {max} tak WhatsApp ek saath link karein — sab parallel check karte hain. Slot chunein, number daalein, phir phone
        mein: Linked devices → Link a device → Link with phone number instead → code daalein. Logout ho to usi slot mein
        dobara code lao.
      </p>

      <section className="mt-6 grid gap-2">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
          const s = slots.find((x) => x.slot === n);
          return (
            <button
              key={n}
              type="button"
              onClick={() => setSlot(n)}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm ${slot === n ? "ring-2 ring-ring" : ""}`}
            >
              <span className="font-medium">WhatsApp {n}{s?.phone ? ` · ${s.phone}` : ""}</span>
              <span className={s?.state === "error" ? "text-destructive" : "text-muted-foreground"}>
                {LABEL[s?.state ?? "idle"] ?? s?.state}
              </span>
            </button>
          );
        })}
      </section>

      <form onSubmit={onSubmit} className="mt-6 rounded-xl border bg-card p-5">
        <label className="text-sm font-medium">WhatsApp {slot} ka phone number</label>
        <input name="phone" inputMode="numeric" placeholder="918949446687" className={`mt-2 ${input}`} />
        <button
          type="submit"
          disabled={busy || current?.state === "starting"}
          className="mt-3 rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy || current?.state === "starting" ? "Code aa raha hai..." : "Code lao"}
        </button>
        {msg && <p className="mt-3 text-sm text-destructive">{msg}</p>}
      </form>

      {current?.state === "code" && current.code && (
        <section className="mt-6 rounded-xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">WhatsApp {slot}: phone mein yeh code daalein</p>
          <p className="mt-3 font-mono text-4xl font-bold tracking-widest">{current.code.replace(/,/g, "")}</p>
        </section>
      )}

      {current?.state === "qr" && current.qr && (
        <section className="mt-6 rounded-xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            WhatsApp {slot}: code nahi aaya, isliye QR scan karein — phone mein Linked devices → Link a device → yeh QR scan karein
          </p>
          <img src={current.qr} alt="WhatsApp QR code" className="mx-auto mt-4 w-64 max-w-full rounded-lg bg-background p-2" />
          <p className="mt-2 text-xs text-muted-foreground">QR har kuch second mein badalta hai, page khud update hota hai.</p>
        </section>
      )}

      {current?.state === "error" && (
        <section className="mt-6 rounded-xl border bg-card p-6">
          <p className="font-medium text-destructive">WhatsApp {slot}: link nahi hai</p>
          <p className="mt-1 text-sm text-muted-foreground">{current.error ?? "Dobara Code lao dabayein."}</p>
        </section>
      )}
    </main>
  );
}
