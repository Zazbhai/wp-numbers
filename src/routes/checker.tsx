import { createFileRoute, Link } from "@tanstack/react-router";
import {
  LockKeyhole,
  LogOut,
  ShieldAlert,
  Sliders,
  Globe,
  Key,
  Save,
  RefreshCw,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Server,
  Zap,
  Play,
} from "lucide-react";
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
  getCheckerProviderSettings,
  updateCheckerProviderSettings,
  testCheckerProviderSettings,
  resetCheckerProviderSettings,
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

type Counts = {
  total: number;
  available: number;
  pending: number;
  skipped: number;
  sold?: number;
  expired?: number;
  unregisteredTotal?: number;
};

const DEFAULT_STATUS = {
  label: "In Queue",
  cls: "bg-amber-500/15 text-amber-700 border border-amber-500/30 font-medium",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  available: {
    label: "Unregistered (Ready)",
    cls: "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 font-semibold",
  },
  sent: {
    label: "Unregistered (Ready)",
    cls: "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 font-semibold",
  },
  found: {
    label: "Unregistered (Ready)",
    cls: "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 font-semibold",
  },
  pending_otp: {
    label: "Awaiting OTP (Purchased)",
    cls: "bg-blue-500/15 text-blue-700 border border-blue-500/30 font-semibold",
  },
  completed: {
    label: "Sold (OTP Delivered)",
    cls: "bg-purple-500/15 text-purple-700 border border-purple-500/30 font-semibold",
  },
  expired: {
    label: "Session Expired",
    cls: "bg-rose-500/15 text-rose-700 border border-rose-500/30 font-medium",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-zinc-500/15 text-zinc-600 border border-zinc-500/30 font-medium",
  },
  pending: DEFAULT_STATUS,
  pending_verify: {
    label: "Awaiting 2nd Check",
    cls: "bg-amber-500/15 text-amber-700 border border-amber-500/30 font-medium",
  },
  skipped: {
    label: "On WhatsApp (Refunded)",
    cls: "bg-muted text-muted-foreground border border-border",
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
  const [monitor, setMonitor] = useState<{
    running: boolean;
    pid: number | null;
    state: string;
    isLinked: boolean;
    phone: string | null;
    logs: string;
  }>({
    running: false,
    pid: null,
    state: "idle",
    isLinked: false,
    phone: null,
    logs: "",
  });
  const [showLogs, setShowLogs] = useState(false);
  const [startingEngine, setStartingEngine] = useState(false);

  // SMS Provider parameters state
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerServiceId, setProviderServiceId] = useState("");
  const [providerCountryId, setProviderCountryId] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerBalance, setProviderBalance] = useState<number | null>(null);
  const [providerDefaults, setProviderDefaults] = useState<{
    baseUrl: string;
    serviceId: string;
    countryId: string;
  } | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerTesting, setProviderTesting] = useState(false);
  const [providerResetting, setProviderResetting] = useState(false);
  const [providerMsg, setProviderMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(true);

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

  const loadProviderSettings = useCallback(async () => {
    setProviderLoading(true);
    try {
      const res = await getCheckerProviderSettings();
      if (res.ok && res.settings) {
        setProviderBaseUrl(res.settings.baseUrl);
        setProviderServiceId(res.settings.serviceId);
        setProviderCountryId(res.settings.countryId);
        setProviderApiKey(res.settings.apiKey || "");
        setProviderBalance(res.settings.balance);
        setProviderDefaults(res.settings.defaults);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setProviderLoading(false);
    }
  }, []);

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
    loadProviderSettings();
    getCheckerKey().then(setKey);
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [adminReady, isAdmin, load, loadProviderSettings]);

  async function handleSaveProviderSettings(e: FormEvent) {
    e.preventDefault();
    if (!providerBaseUrl.trim() || !providerServiceId.trim() || !providerCountryId.trim()) {
      setProviderMsg({
        type: "error",
        text: "Base URL, Service ID, aur Country ID enter karna zaroori hai.",
      });
      return;
    }
    setProviderSaving(true);
    setProviderMsg(null);
    try {
      const res = await updateCheckerProviderSettings({
        data: {
          baseUrl: providerBaseUrl.trim(),
          serviceId: providerServiceId.trim(),
          countryId: providerCountryId.trim(),
          apiKey: providerApiKey.trim(),
        },
      });
      if (res.ok) {
        setProviderBalance(res.balance ?? null);
        setProviderMsg({
          type: "success",
          text: `Settings save ho gayi! ${res.balance !== null ? `Live Provider Balance: ₹${res.balance}` : ""}`,
        });
      } else {
        setProviderMsg({ type: "error", text: res.error || "Save karne mein error aayi" });
      }
    } catch {
      setProviderMsg({ type: "error", text: "Provider settings save nahi ho payi." });
    } finally {
      setProviderSaving(false);
    }
  }

  async function handleTestProviderConnection() {
    if (!providerBaseUrl.trim() || !providerApiKey.trim()) {
      setProviderMsg({
        type: "error",
        text: "Connection test ke liye Base URL aur API Key dono enter karein.",
      });
      return;
    }
    setProviderTesting(true);
    setProviderMsg(null);
    try {
      const res = await testCheckerProviderSettings({
        data: {
          baseUrl: providerBaseUrl.trim(),
          apiKey: providerApiKey.trim(),
        },
      });
      if (res.ok) {
        setProviderBalance(res.balance);
        setProviderMsg({
          type: "success",
          text: `Connection test PASS! Live balance: ₹${res.balance}`,
        });
      } else {
        setProviderMsg({
          type: "error",
          text: res.error || "Connection test failed — Base URL ya API Key check karein.",
        });
      }
    } catch {
      setProviderMsg({ type: "error", text: "Provider endpoint reach nahi ho saka." });
    } finally {
      setProviderTesting(false);
    }
  }

  async function handleResetProviderSettings() {
    if (!confirm("Provider settings ko default environment (.env) par reset karna hai?")) return;
    setProviderResetting(true);
    setProviderMsg(null);
    try {
      const res = await resetCheckerProviderSettings();
      if (res.ok) {
        await loadProviderSettings();
        setProviderMsg({ type: "success", text: "Settings default (.env) par reset ho gayi!" });
      }
    } catch {
      setProviderMsg({ type: "error", text: "Reset fail ho gaya." });
    } finally {
      setProviderResetting(false);
    }
  }

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
    const serviceName = providerServiceId || "SMS API";
    setMsg(`${serviceName} se numbers fetch ho rahe hain...`);
    const res = await fetchNumberFromApi({
      data: {
        count: fetchCount,
        service: providerServiceId.trim() || undefined,
        country: providerCountryId.trim() || undefined,
      },
    });
    setFetching(false);
    if (res.ok && res.phones) {
      setMsg(
        res.note
          ? res.note
          : `${serviceName} se ${res.phones.length} naye number queue mein add kiye gaye aur checking shuru ho gayi!`,
      );
      load();
    } else {
      setMsg(res.error || `${serviceName} se number nahi mile`);
    }
  }

  const shown = rows.filter((r) => {
    const matchesQuery = r.phone.includes(query.replace(/\s/g, ""));
    if (!matchesQuery) return false;
    if (filter === "all") return true;
    if (filter === "available") return ["available", "sent", "found"].includes(r.status);
    if (filter === "sold") return ["completed", "pending_otp"].includes(r.status);
    if (filter === "expired") return r.status === "expired";
    if (filter === "pending") return ["pending", "pending_verify"].includes(r.status);
    if (filter === "skipped") return r.status === "skipped";
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
                className={`size-3 rounded-full ${
                  monitor.running && monitor.isLinked
                    ? "bg-emerald-500 animate-pulse"
                    : monitor.running
                      ? "bg-amber-500 animate-pulse"
                      : "bg-rose-500"
                }`}
              />
              <h2 className="font-bold text-base flex items-center gap-2">
                WhatsApp Checking Engine:{" "}
                {monitor.running && monitor.isLinked
                  ? "ACTIVE & WHATSAPP CONNECTED"
                  : monitor.running
                    ? "BROWSER ACTIVE — WA NOT LINKED"
                    : "STOPPED / IDLE"}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {monitor.running && monitor.isLinked
                ? `Monitor background mein active hai (PID ${monitor.pid || "running"}). WhatsApp account linked hai aur queue check karne ke liye tayyar hai.`
                : monitor.running
                  ? `Chromium browser background mein chal raha hai par WhatsApp account linked nahi hai (State: ${monitor.state}). Numbers check karne ke liye pehle WhatsApp link karein.`
                  : "Checking engine ruka hua hai. Start karne ke liye niche button dabayein ya /link par WhatsApp connect karein."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleStartEngine}
              disabled={startingEngine}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition disabled:opacity-60 shadow-sm"
              title="Manually trigger WhatsApp checker engine and run queued checks"
            >
              {startingEngine ? (
                <>
                  <RefreshCw className="size-3.5 animate-spin" />
                  <span>Starting Engine...</span>
                </>
              ) : (
                <>
                  <Play className="size-3.5 fill-current" />
                  <span>{monitor.running ? "Manual Check / Restart Engine" : "Start Checking Now"}</span>
                </>
              )}
            </button>
            <Link
              to="/link"
              className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent transition"
            >
              Link WhatsApp (/link)
            </Link>
            <button
              type="button"
              onClick={() => setShowLogs((prev) => !prev)}
              className="rounded-lg border bg-muted px-3 py-2 text-xs font-medium hover:bg-accent transition"
            >
              {showLogs ? "Hide Console Logs" : "Show Console Logs"}
            </button>
          </div>
        </div>

        {/* WhatsApp Not Linked Warning Callout */}
        {monitor.running && !monitor.isLinked && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-amber-900 text-sm">
                  WhatsApp Web Linked Nahi Hai — Number Checking Shuru Nahi Ho Sakti!
                </h3>
                <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                  WhatsApp par numbers check karne ke liye checker browser mein aapka WhatsApp Web account logged in hona zaroori hai. Abhi browser login screen / QR code par ruka hua hai.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Link
                    to="/link"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 text-xs font-bold transition shadow-sm"
                  >
                    <span>WhatsApp Link Karein (/link) →</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Live Logs Viewer Box */}
        {showLogs && (
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-semibold text-muted-foreground flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" />
                Live Monitor Console Logs (.wa-data/slot-1/monitor.log)
              </span>
              <button
                type="button"
                onClick={load}
                className="text-[11px] text-muted-foreground hover:text-foreground underline flex items-center gap-1"
              >
                <RefreshCw className="size-3" />
                Refresh logs
              </button>
            </div>
            <pre className="max-h-64 overflow-y-auto rounded-lg bg-black/90 p-3 font-mono text-[11px] text-emerald-400 whitespace-pre-wrap border border-emerald-950">
              {monitor.logs || "No logs available. Start checking engine to see output."}
            </pre>
          </div>
        )}
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
      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-emerald-800">
              🎉 Kul Khoje Gaye Unregistered Numbers: {counts.unregisteredTotal ?? (counts.available + (counts.sold || 0) + (counts.expired || 0))}
            </span>
            <span className="text-emerald-700">
              ({counts.available} Ready · {counts.sold || 0} Sold/OTP · {counts.expired || 0} Session Timeout)
            </span>
          </div>
          <span className="text-[11px] text-emerald-700">
            100% data accounted for ({counts.total} total)
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold">{counts.total}</p>
            <p className="text-xs text-muted-foreground mt-1">Total Numbers</p>
          </div>
          <div className="rounded-xl border bg-card p-4 border-emerald-500/30 bg-emerald-500/5">
            <p className="text-2xl font-bold text-emerald-600">{counts.available}</p>
            <p className="text-xs text-emerald-800 font-semibold mt-1">Unregistered (Ready)</p>
          </div>
          <div className="rounded-xl border bg-card p-4 border-blue-500/30 bg-blue-500/5">
            <p className="text-2xl font-bold text-blue-600">{counts.sold || 0}</p>
            <p className="text-xs text-blue-800 font-medium mt-1">Sold / OTP Done</p>
          </div>
          <div className="rounded-xl border bg-card p-4 border-rose-500/20 bg-rose-500/5">
            <p className="text-2xl font-bold text-rose-600">{counts.expired || 0}</p>
            <p className="text-xs text-rose-800 font-medium mt-1">Session Expired</p>
          </div>
          <div className="rounded-xl border bg-card p-4 border-amber-500/30 bg-amber-500/5">
            <p className="text-2xl font-bold text-amber-600">{counts.pending}</p>
            <p className="text-xs text-amber-800 font-medium mt-1">In Queue (Pending)</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold text-muted-foreground">{counts.skipped}</p>
            <p className="text-xs text-muted-foreground mt-1">On WhatsApp (Refund)</p>
          </div>
        </div>
      </div>

      {/* Provider API Parameters Section */}
      <section className="mt-8 rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sliders className="size-5" />
            </div>
            <div>
              <h2 className="font-bold text-base flex items-center gap-2">
                SMS Provider API Parameters
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-500/30">
                  Live Parameters
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Base URL, Service ID, Country ID aur API Key parameters ko yahan se easily change karein.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border ${
                providerBalance !== null
                  ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              <Zap className="size-3.5" />
              <span>
                {providerBalance !== null
                  ? `Balance: ₹${providerBalance.toFixed(2)}`
                  : "Balance: Not connected"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setProviderSettingsOpen((prev) => !prev)}
              aria-label="Toggle provider parameters"
              className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
            >
              {providerSettingsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          </div>
        </div>

        {providerSettingsOpen && (
          <form onSubmit={handleSaveProviderSettings} className="mt-4 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Globe className="size-3.5 text-primary" />
                  API Base URL (Handler URL)
                </label>
                {providerDefaults && (
                  <button
                    type="button"
                    onClick={() => setProviderBaseUrl(providerDefaults.baseUrl)}
                    className="text-[11px] text-muted-foreground hover:text-primary transition underline"
                  >
                    Set default URL
                  </button>
                )}
              </div>
              <input
                type="text"
                value={providerBaseUrl}
                onChange={(e) => setProviderBaseUrl(e.target.value)}
                placeholder="https://furysms.shop/stubs/handler_api.php"
                className="mt-1.5 w-full rounded-lg border bg-background px-3.5 py-2.5 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                required
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Upstream provider handler URL (supports FurySMS, SMS-Activate protocol, 5SIM protocol handlers).
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Server className="size-3.5 text-primary" />
                    Service ID (Code)
                  </label>
                  {providerDefaults && (
                    <button
                      type="button"
                      onClick={() => setProviderServiceId(providerDefaults.serviceId)}
                      className="text-[11px] text-muted-foreground hover:text-primary transition underline"
                    >
                      Default ({providerDefaults.serviceId})
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={providerServiceId}
                  onChange={(e) => setProviderServiceId(e.target.value)}
                  placeholder="boyaah"
                  className="mt-1.5 w-full rounded-lg border bg-background px-3.5 py-2.5 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                  required
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setProviderServiceId("boyaah")}
                    className={`rounded px-1.5 py-0.5 transition ${providerServiceId === "boyaah" ? "bg-primary/20 text-primary font-bold" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    boyaah (WA Special)
                  </button>
                  <button
                    type="button"
                    onClick={() => setProviderServiceId("wa")}
                    className={`rounded px-1.5 py-0.5 transition ${providerServiceId === "wa" ? "bg-primary/20 text-primary font-bold" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    wa (Standard WhatsApp)
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Globe className="size-3.5 text-primary" />
                    Country Code (ID)
                  </label>
                  {providerDefaults && (
                    <button
                      type="button"
                      onClick={() => setProviderCountryId(providerDefaults.countryId)}
                      className="text-[11px] text-muted-foreground hover:text-primary transition underline"
                    >
                      Default ({providerDefaults.countryId})
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={providerCountryId}
                  onChange={(e) => setProviderCountryId(e.target.value)}
                  placeholder="22"
                  className="mt-1.5 w-full rounded-lg border bg-background px-3.5 py-2.5 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                  required
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setProviderCountryId("22")}
                    className={`rounded px-1.5 py-0.5 transition ${providerCountryId === "22" ? "bg-primary/20 text-primary font-bold" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    22 (India +91)
                  </button>
                  <button
                    type="button"
                    onClick={() => setProviderCountryId("0")}
                    className={`rounded px-1.5 py-0.5 transition ${providerCountryId === "0" ? "bg-primary/20 text-primary font-bold" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    0 (Russia +7)
                  </button>
                  <button
                    type="button"
                    onClick={() => setProviderCountryId("6")}
                    className={`rounded px-1.5 py-0.5 transition ${providerCountryId === "6" ? "bg-primary/20 text-primary font-bold" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    6 (Indonesia +62)
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Key className="size-3.5 text-primary" />
                Provider API Key
              </label>
              <div className="relative mt-1.5">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={providerApiKey}
                  onChange={(e) => setProviderApiKey(e.target.value)}
                  placeholder="Enter upstream API key"
                  className="w-full rounded-lg border bg-background px-3.5 py-2.5 pr-10 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showApiKey ? "Hide API Key" : "Show API Key"}
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Secret API key for account authorization. Leave blank to keep existing key.
              </p>
            </div>

            {providerMsg && (
              <div
                className={`flex items-center gap-2 rounded-lg p-3 text-xs font-medium border ${
                  providerMsg.type === "success"
                    ? "bg-emerald-500/10 text-emerald-800 border-emerald-500/30"
                    : "bg-rose-500/10 text-rose-800 border-rose-500/30"
                }`}
              >
                {providerMsg.type === "success" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="size-4 shrink-0 text-rose-600" />
                )}
                <span>{providerMsg.text}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={providerSaving || providerLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                >
                  <Save className="size-3.5" />
                  <span>{providerSaving ? "Saving..." : "Save Parameters"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestProviderConnection}
                  disabled={providerTesting || providerLoading || !providerBaseUrl || !providerApiKey}
                  className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent transition disabled:opacity-50"
                >
                  <RefreshCw className={`size-3.5 ${providerTesting ? "animate-spin" : ""}`} />
                  <span>{providerTesting ? "Testing..." : "Test Connection"}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleResetProviderSettings}
                disabled={providerResetting || providerLoading}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition underline disabled:opacity-50"
              >
                <RotateCcw className="size-3" />
                <span>Reset to .env defaults</span>
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Add / Fetch numbers */}
      <form onSubmit={onAdd} className="mt-8 rounded-xl border bg-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">Numbers jodein ya SMS API se auto-pull karein</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ek line mein ek number — ya direct configured SMS provider se numbers lein.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-lg font-mono w-fit">
            <span>Service: <strong className="text-foreground">{providerServiceId || "boyaah"}</strong></span>
            <span>•</span>
            <span>Country: <strong className="text-foreground">{providerCountryId || "22"}</strong></span>
          </div>
        </div>
        <textarea
          name="numbers"
          rows={3}
          placeholder={"9876543210\n+91 80008 58534\n12025550123"}
          className={`mt-3 ${input}`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
            className="rounded-lg border border-primary/50 bg-primary/10 px-5 py-2.5 text-sm font-semibold transition hover:bg-primary/20 disabled:opacity-60 flex items-center gap-1.5"
          >
            {fetching ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                <span>Pulling numbers...</span>
              </>
            ) : (
              <span>Fresh numbers pull karein ({providerServiceId || "boyaah"})</span>
            )}
          </button>

          <button
            type="button"
            onClick={handleStartEngine}
            disabled={startingEngine}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 text-sm font-bold transition disabled:opacity-60 flex items-center gap-2 shadow-sm sm:ml-auto"
            title="Manually trigger WhatsApp checker to verify pending numbers"
          >
            {startingEngine ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                <span>Checking Engine Starting...</span>
              </>
            ) : (
              <>
                <Play className="size-4 fill-white" />
                <span>Start Checking Now ({counts.pending} In Queue)</span>
              </>
            )}
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
                ["all", `Sab (${counts.total})`],
                ["available", `Ready (${counts.available})`],
                ["sold", `Sold (${counts.sold || 0})`],
                ["expired", `Expired (${counts.expired || 0})`],
                ["pending", `In Queue (${counts.pending})`],
                ["skipped", `On WA (${counts.skipped})`],
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
