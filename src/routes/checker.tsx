import { createFileRoute, Link } from "@tanstack/react-router";
import { LockKeyhole, LogOut, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addNumbers,
  deleteNumber,
  fetchNumberFromApi,
  getCheckerKey,
  listNumbers,
  recheckNumber,
  getMonitorStatus,
  startChecker,
} from "@/lib/wa-check.functions";
import {
  checkAdminAccess,
  lockAdminSession,
  unlockAdminWithKey,
} from "@/lib/admin-auth.functions";

export const Route = createFileRoute("/checker")({
  head: () => ({
    meta: [
      { title: "Checker Dashboard — Register Checker" },
      {
        name: "description",
        content:
          "WhatsApp check ke numbers, unka status aur Telegram bheje gaye numbers ka dashboard.",
      },
      { property: "og:title", content: "Checker Dashboard" },
      {
        property: "og:description",
        content: "Numbers ki list aur check results ek jagah dekhein.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CheckerPage,
});

type Row = {
  phone: string;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type Counts = { total: number; available: number; pending: number; skipped: number };

const DEFAULT_STATUS = {
  label: "Check baaki",
  cls: "bg-amber-500/15 text-amber-700 border border-amber-500/30 font-medium",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  available: {
    label: "Unregistered (Marketplace)",
    cls: "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 font-semibold",
  },
  sent: {
    label: "Unregistered (Telegram bheja)",
    cls: "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 font-semibold",
  },
  found: {
    label: "Unregistered (Mila)",
    cls: "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 font-semibold",
  },
  pending: DEFAULT_STATUS,
  skipped: {
    label: "WhatsApp par mila (Refunded)",
    cls: "bg-muted text-muted-foreground border border-border",
  },
  pending_otp: {
    label: "OTP baaki (In purchase)",
    cls: "bg-blue-500/15 text-blue-700 border border-blue-500/30 font-semibold",
  },
  completed: {
    label: "OTP received (Sold)",
    cls: "bg-purple-500/15 text-purple-700 border border-purple-500/30 font-semibold",
  },
};

function CheckerPage() {
  const [adminReady, setAdminReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, available: 0, pending: 0, skipped: 0 });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchCount, setFetchCount] = useState(5);
  const [origin, setOrigin] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [copied, setCopied] = useState(false);
  const [monitor, setMonitor] = useState<{ running: boolean; state: string; phone: string | null }>(
    {
      running: false,
      state: "idle",
      phone: null,
    },
  );
  const [startingEngine, setStartingEngine] = useState(false);

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
      setRows([]);
      setCounts({ total: 0, available: 0, pending: 0, skipped: 0 });
    }
  }

  const load = useCallback(async () => {
    try {
      const [res, mon] = await Promise.all([listNumbers(), getMonitorStatus()]);
      if (res.ok) {
        setRows(res.numbers);
        setCounts(res.counts);
      }
      if (mon) setMonitor(mon);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (!adminReady || !isAdmin) return;
    setOrigin(window.location.origin);
    load();
    getCheckerKey().then(setKey);
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [adminReady, isAdmin, load]);

  async function handleStartEngine() {
    setStartingEngine(true);
    setMsg("Checking engine start ho raha hai...");
    const res = await startChecker();
    setTimeout(() => {
      load();
      setStartingEngine(false);
      setMsg(
        res.ok
          ? "Checking engine shuru ho gaya hai!"
          : "Engine shuru nahi ho saka — /link par check karein.",
      );
    }, 2000);
  }

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get("numbers") ?? "");
    setBusy(true);
    setMsg("");
    const res = await addNumbers({ data: { raw } });
    setBusy(false);
    if (res.ok) {
      setMsg(
        `${res.added} number jode gaye${res.invalid.length ? ` — ye samajh nahi aaye: ${res.invalid.join(", ")}` : ""}`,
      );
      (e.target as HTMLFormElement).reset();
      load();
    } else {
      setMsg(res.error);
    }
  }

  async function onFetchFromApi() {
    setFetching(true);
    setMsg("FurySMS se numbers fetch ho rahe hain...");
    const res = await fetchNumberFromApi({ data: { count: fetchCount } });
    setFetching(false);
    if (res.ok && res.phones) {
      setMsg(
        res.note
          ? res.note
          : `FurySMS se ${res.phones.length} naye number queue mein add kiye gaye aur checking shuru ho gayi!`,
      );
      load();
    } else {
      setMsg(res.error || "FurySMS se number nahi mile");
    }
  }

  const shown = rows.filter((r) => {
    const matchesQuery = r.phone.includes(query.replace(/\s/g, ""));
    if (!matchesQuery) return false;
    if (filter === "all") return true;
    if (filter === "available") return ["available", "sent", "found"].includes(r.status);
    return r.status === filter;
  });

  function exportCsv() {
    const lines = [
      "phone,status,note,updated_at",
      ...shown.map((r) =>
        [r.phone, r.status, (r.note ?? "").replace(/,/g, " "), r.updated_at].join(","),
      ),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `numbers-${filter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onRecheck(phone: string) {
    await recheckNumber({ data: { phone } });
    load();
  }
  async function onDelete(phone: string) {
    if (!confirm(`${phone} hata dein?`)) return;
    await deleteNumber({ data: { phone } });
    load();
  }

  const input =
    "w-full rounded-lg border bg-card px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring";

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
            The Number Checker Dashboard is restricted to system administrators. Regular users can browse available WhatsApp numbers in the Marketplace.
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
              {unlocking ? "Verifying..." : "Unlock Checker"}
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
    <main className="mx-auto min-h-screen max-w-4xl px-5 py-14">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          <Link to="/numbers" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            ← Marketplace
          </Link>
          <span className="text-xs text-muted-foreground">|</span>
          <Link to="/link" className="text-xs font-medium text-muted-foreground hover:text-foreground">
            WA Linker
          </Link>
          <Link to="/numbers/admin" className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Admin Panel
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/numbers"
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition"
          >
            Public Marketplace →
          </Link>
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
      </div>

      <h1 className="mt-6 text-3xl font-bold">Checker Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        WhatsApp check wale numbers, unka status aur Telegram par bheje gaye numbers — sab ek jagah.
      </p>

      {/* Engine Status Banner */}
      <div className="mt-6 rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`size-3 rounded-full ${monitor.running ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}
              />
              <h2 className="font-bold text-base">
                WhatsApp Checking Engine: {monitor.running ? "ACTIVE & RUNNING" : "STOPPED / IDLE"}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {monitor.running
                ? `Monitor background mein active hai. State: ${monitor.state}. Auto-refill target: 50 unregistered numbers. Har 1 ghante mein auto-check & restart process shuru hota hai.`
                : "Checking ruki hui hai. Start karne ke liye niche button dabayein ya /link par WhatsApp connect karein."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!monitor.running && (
              <button
                onClick={handleStartEngine}
                disabled={startingEngine}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition disabled:opacity-60"
              >
                {startingEngine ? "Starting..." : "Start Checking Now"}
              </button>
            )}
            <Link
              to="/link"
              className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent transition"
            >
              Link WhatsApp (/link)
            </Link>
          </div>
        </div>
      </div>

      {/* Marketplace Banner */}
      <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-sm">WhatsApp Numbers Marketplace Live</p>
          <p className="text-xs text-muted-foreground">
            Users can view all verified unregistered WhatsApp numbers and buy them with live SMS OTP
            code.
          </p>
        </div>
        <Link
          to="/numbers"
          className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 transition shrink-0"
        >
          Open Marketplace ({counts.available} Ready) →
        </Link>
      </div>

      {/* Counts Grid */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-2xl font-bold">{counts.total}</p>
          <p className="text-sm text-muted-foreground">Total numbers</p>
        </div>
        <div className="rounded-xl border bg-card p-4 border-emerald-500/30 bg-emerald-500/5">
          <p className="text-2xl font-bold text-emerald-600">{counts.available}</p>
          <p className="text-sm text-emerald-800 font-medium">Unregistered (Ready)</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-2xl font-bold text-amber-600">{counts.pending}</p>
          <p className="text-sm text-muted-foreground">Check baaki (In Queue)</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-2xl font-bold text-muted-foreground">{counts.skipped}</p>
          <p className="text-sm text-muted-foreground">Skip hue (On WhatsApp)</p>
        </div>
      </div>

      {/* Add / Fetch numbers */}
      <form onSubmit={onAdd} className="mt-8 rounded-xl border bg-card p-5">
        <h2 className="font-bold">Numbers jodein ya FurySMS se auto-pull karein</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ek line mein ek number — ya direct FurySMS API se numbers lein.
        </p>
        <textarea
          name="numbers"
          rows={3}
          placeholder={"9876543210\n+91 80008 58534\n12025550123"}
          className={`mt-3 ${input}`}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60 text-sm"
          >
            {busy ? "Ho raha hai..." : "Numbers jodein"}
          </button>
          <select
            value={fetchCount}
            onChange={(e) => setFetchCount(Number(e.target.value))}
            disabled={fetching}
            className="rounded-lg border bg-card px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          >
            {[3, 5, 10, 20].map((n) => (
              <option key={n} value={n}>
                {n} numbers
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onFetchFromApi}
            disabled={fetching}
            className="rounded-lg border border-primary/50 bg-primary/10 px-5 py-2.5 text-sm font-semibold transition hover:bg-primary/20 disabled:opacity-60"
          >
            {fetching ? "FurySMS se aa raha hai..." : "FurySMS se fresh number lo"}
          </button>
        </div>
        {msg && <p className="mt-3 text-sm text-muted-foreground font-medium">{msg}</p>}
      </form>

      {/* Checker Key Section */}
      <section className="mt-8 rounded-xl border bg-card p-5">
        <h2 className="font-bold">Phone automation webhook address</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Playwright monitor is URL par results POST karta hai:
        </p>
        <code className="mt-3 block overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">
          {origin ? `${origin}/api/public/wa-result` : "/api/public/wa-result"}
        </code>
        {key ? (
          <div className="mt-2 flex gap-2">
            <code className="block flex-1 break-all rounded-lg bg-muted px-3 py-2 text-xs">
              {key}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(key);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-lg border px-3 text-xs font-medium transition hover:bg-accent"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <button
            onClick={async () => setKey(await getCheckerKey())}
            className="mt-2 rounded-lg border px-4 py-2 text-sm font-medium transition hover:bg-accent"
          >
            Key dikhayein
          </button>
        )}
      </section>

      {/* Numbers List Table */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Numbers ki list</h2>
            <p className="text-xs text-muted-foreground">
              Latest {rows.length} of {counts.total} numbers
            </p>
          </div>
          <button
            onClick={exportCsv}
            disabled={shown.length === 0}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
          >
            CSV download ({shown.length})
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Number search karein..."
            className="flex-1 rounded-lg border bg-card px-4 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["all", "Sab"],
                ["available", "Unregistered (Ready)"],
                ["pending", "Baaki (Queue)"],
                ["skipped", "Skip (On WA)"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                  filter === v
                    ? "bg-primary text-primary-foreground font-bold"
                    : "border hover:bg-accent"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground p-4 text-center rounded-xl border bg-card">
            Koi number nahi mila.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Number</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Note / Action</th>
                  <th className="px-4 py-3 font-medium">Update</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const s = STATUS[r.status] ?? DEFAULT_STATUS;
                  const isAvailable = ["available", "sent", "found"].includes(r.status);
                  return (
                    <tr key={r.phone} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono font-medium">{r.phone}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${s.cls}`}
                        >
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {isAvailable ? (
                          <Link
                            to="/numbers"
                            className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:underline"
                          >
                            Marketplace mein dekhein →
                          </Link>
                        ) : (
                          r.note || "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.updated_at
                          ? new Date(r.updated_at).toLocaleString("en-IN", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {r.status !== "pending" && (
                          <button
                            onClick={() => onRecheck(r.phone)}
                            className="mr-2 text-xs font-medium text-primary hover:underline"
                          >
                            Dobara check
                          </button>
                        )}
                        <button
                          onClick={() => onDelete(r.phone)}
                          className="text-xs font-medium text-destructive hover:underline"
                        >
                          Hatao
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
