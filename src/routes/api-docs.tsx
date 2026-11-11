import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Plus,
  RefreshCw,
  Sparkles,
  Terminal,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  getOrCreateApiKey,
  generateNewApiKey,
  topUpApiKeyBalance,
  type ApiKeyItem,
} from "@/lib/api-key.functions";

export const Route = createFileRoute("/api-docs")({
  head: () => ({
    meta: [
      { title: "API Documentation — WhatsApp Numbers" },
      {
        name: "description",
        content:
          "Integrate WhatsApp unregistered numbers into your application. Get a number, receive OTP via API.",
      },
    ],
  }),
  component: ApiDocsPage,
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <div className="rounded-xl border border-border bg-card p-8">
        <h2 className="text-lg font-bold text-foreground">API Documentation Loading Error</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          {error instanceof Error ? error.message : "Could not load the documentation view."}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => reset()}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
          <a
            href="/numbers"
            className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent"
          >
            Go to Marketplace
          </a>
        </div>
      </div>
    </div>
  ),
});

// ── helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://your-domain.com/api/v1";

function Badge({
  color,
  children,
}: {
  color: "green" | "blue" | "orange";
  children: React.ReactNode;
}) {
  const cls = {
    green: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
    blue: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
    orange: "bg-orange-500/15 text-orange-400 border border-orange-500/30",
  }[color];
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-mono font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
    >
      {copied ? (
        <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ code, lang = "text" }: { code: string; lang?: string }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-[#263932] bg-[#14211c] text-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[10px] font-medium uppercase text-[#a5b9ad]">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-6 text-[#e0ebe4]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface Param {
  name: string;
  value: string;
  desc: string;
  optional?: boolean;
}

interface ResponseExample {
  label: string;
  value: string;
}

interface EndpointProps {
  method?: string;
  action: string;
  title: string;
  desc: string;
  params: Param[];
  responses: ResponseExample[];
  note?: string;
  apiKey?: string;
  baseUrl?: string;
}

function Endpoint({
  method = "GET",
  action,
  title,
  desc,
  params,
  responses,
  note,
  apiKey,
  baseUrl,
}: EndpointProps) {
  const [open, setOpen] = useState(false);
  const [activeRes, setActiveRes] = useState(0);
  const endpointId = `endpoint-${action.toLowerCase()}`;

  const currentKey = apiKey || "YOUR_API_KEY";
  const currentBase = baseUrl || BASE_URL;
  const urlExample =
    `${currentBase}?action=${action}&api_key=${currentKey}` +
    params
      .filter((p) => p.name !== "action" && p.name !== "api_key" && !p.optional)
      .map((p) => `&${p.name}=${p.value}`)
      .join("");

  return (
    <section id={endpointId} className="scroll-mt-24 border-b border-border py-1">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${endpointId}-details`}
        className="flex min-h-16 w-full flex-wrap items-center gap-x-3 gap-y-1.5 py-4 text-left"
      >
        <Badge color="green">{method}</Badge>
        <span className="font-mono text-sm font-semibold text-foreground">{action}</span>
        <span className="basis-full pl-[4.8rem] text-sm text-muted-foreground sm:basis-auto sm:pl-0">
          {title}
        </span>
        <span className="ml-auto grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </button>

      {open && (
        <div id={`${endpointId}-details`} className="border-t border-border pb-5 pt-4">
          <p className="mb-5 max-w-3xl text-sm leading-6 text-muted-foreground">{desc}</p>
          <div className="grid gap-7 lg:grid-cols-[1fr_0.9fr]">
            {/* Left: params */}
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Query parameters
                </h4>
                <div className="divide-y divide-border border-y border-border">
                  {[
                    { name: "action", value: action, desc: "API action name", optional: false },
                    {
                      name: "api_key",
                      value: currentKey,
                      desc: "Your secret API key",
                      optional: false,
                    },
                    ...params,
                  ].map((p) => (
                    <div key={p.name} className="flex items-start gap-3 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium text-foreground">
                            {p.name}
                          </span>
                          {p.optional && (
                            <span className="text-[10px] text-muted-foreground border border-border rounded px-1">
                              optional
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{p.desc}</span>
                      </div>
                      <span className="max-w-[120px] shrink-0 truncate font-mono text-xs text-muted-foreground">
                        {p.name === "api_key" && currentKey !== "YOUR_API_KEY"
                          ? currentKey.slice(0, 10) + "..."
                          : p.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <CodeBlock code={urlExample} lang="URL" />
            </div>

            {/* Right: responses */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                Example responses
              </h4>
              <div className="flex flex-wrap gap-2">
                {responses.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveRes(i)}
                    aria-pressed={activeRes === i}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                      activeRes === i
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <CodeBlock code={responses[activeRes]?.value ?? ""} lang="Response" />
              {note && (
                <p className="border-l-2 border-primary/50 pl-3 text-xs leading-5 text-muted-foreground">
                  <span className="font-semibold text-foreground">Note: </span>
                  {note}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Error Codes table ─────────────────────────────────────────────────────────

const ERROR_CODES = [
  { code: "BAD_KEY", desc: "Invalid API key format or not found" },
  { code: "WRONG_ACTION", desc: "Invalid action parameter" },
  { code: "NO_BALANCE", desc: "Insufficient wallet balance (₹49 required per number)" },
  { code: "NO_NUMBER", desc: "No unregistered numbers available right now — try again shortly" },
  { code: "NO_ACTIVATION", desc: "Order ID not found or expired" },
  { code: "BAD_STATUS", desc: "Invalid status code (use 3 or 8)" },
  { code: "BAD_ACTION", desc: "Action not permitted for this order's current state" },
  {
    code: "EARLY_CANCEL_DENIED:N",
    desc: "Cancel cooldown active — N seconds remaining before refund",
  },
  { code: "ACCESS_ACTIVATION", desc: "Cannot cancel — SMS already received or order completed" },
  { code: "NUMBER_STILL_ACTIVE", desc: "regetNumber error: previous activation is still active" },
  { code: "ERROR", desc: "Provider error or order activation cannot be renewed" },
  { code: "RATE_LIMIT_EXCEEDED", desc: "30 requests/sec limit exceeded — HTTP 429 returned" },
];

// ── Main page ─────────────────────────────────────────────────────────────────

function ApiDocsPage() {
  const [exampleLang, setExampleLang] = useState<"python" | "javascript" | "php">("python");
  const [apiKeyData, setApiKeyData] = useState<ApiKeyItem | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [loadingKey, setLoadingKey] = useState(true);
  const [toppingUp, setToppingUp] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showGenModal, setShowGenModal] = useState(false);
  const [customEmail, setCustomEmail] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [origin, setOrigin] = useState("https://your-domain.com");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? localStorage.getItem("wa_api_key") || undefined
        : undefined;

    getOrCreateApiKey({ data: { storedKey: stored } })
      .then((res) => {
        if (res?.ok && res.apiKey) {
          setApiKeyData(res.apiKey);
          if (typeof window !== "undefined") {
            localStorage.setItem("wa_api_key", res.apiKey.key);
          }
        }
      })
      .catch((err) => console.error("Failed to load API key:", err))
      .finally(() => setLoadingKey(false));
  }, []);

  const activeKey = apiKeyData?.key || "YOUR_API_KEY";
  const displayedKey = showKey
    ? activeKey
    : apiKeyData
      ? apiKeyData.maskedKey
      : "••••••••••••••••••••••••••••••••";

  const handleCopyKey = () => {
    if (!apiKeyData) return;
    navigator.clipboard.writeText(apiKeyData.key).catch(() => {});
    setCopiedKey(true);
    setNotice("API key copied to clipboard!");
    setTimeout(() => {
      setCopiedKey(false);
      setNotice(null);
    }, 2200);
  };

  const handleTopUp = async (amount = 100) => {
    if (!apiKeyData) return;
    setToppingUp(true);
    try {
      const res = await topUpApiKeyBalance({
        data: { key: apiKeyData.key, amount },
      });
      if (res?.ok && res.newBalance !== undefined) {
        setApiKeyData((prev) =>
          prev
            ? {
                ...prev,
                balance: res.newBalance,
                balanceFormatted: res.balanceFormatted,
              }
            : prev,
        );
        setNotice(`Added +₹${amount} test balance to your API key!`);
        setTimeout(() => setNotice(null), 3000);
      }
    } catch (err) {
      console.error("Top-up failed:", err);
    } finally {
      setToppingUp(false);
    }
  };

  const handleGenerateKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setGenerating(true);
    try {
      const res = await generateNewApiKey({
        data: {
          email: customEmail.trim() || undefined,
          label: customLabel.trim() || "Live API Key",
        },
      });
      if (res?.ok && res.apiKey) {
        setApiKeyData(res.apiKey);
        setShowKey(true);
        if (typeof window !== "undefined") {
          localStorage.setItem("wa_api_key", res.apiKey.key);
        }
        setShowGenModal(false);
        setCustomEmail("");
        setCustomLabel("");
        setNotice("Generated new live API key with ₹200 free credits!");
        setTimeout(() => setNotice(null), 4000);
      }
    } catch (err) {
      console.error("Generate key failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="grid size-7 place-items-center rounded bg-primary text-xs font-bold text-primary-foreground">
              W
            </span>
            WhatsApp Numbers
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground sm:gap-6">
            {apiKeyData && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-mono font-medium text-emerald-400">
                <Wallet className="h-3 w-3" />
                {apiKeyData.balanceFormatted}
              </span>
            )}
            <a href="#authentication" className="hidden hover:text-foreground sm:inline">
              API Key
            </a>
            <a href="#quick-start" className="hidden hover:text-foreground sm:inline">
              Quick start
            </a>
            <a href="#endpoints" className="hover:text-foreground">
              Endpoints
            </a>
            <Link to="/numbers" className="text-foreground hover:text-primary">
              Marketplace
            </Link>
          </nav>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:block">
          <nav
            aria-label="API reference navigation"
            className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto py-8"
          >
            <p className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Guide</p>
            <a
              href="#quick-start"
              className="block rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Quick start
            </a>
            <a
              href="#authentication"
              className="block rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Authentication
            </a>
            <a
              href="#endpoints"
              className="mt-5 block px-2 text-[10px] font-semibold uppercase text-muted-foreground"
            >
              Endpoints
            </a>
            <div className="mt-2 border-l border-border pl-2">
              {[
                ["getbalance", "getBalance"],
                ["getnumber", "getNumber"],
                ["getnumberv2", "getNumberV2"],
                ["getstatus", "getStatus"],
                ["setstatus", "setStatus"],
                ["regetnumber", "regetNumber"],
              ].map(([id, action]) => (
                <a
                  key={id}
                  href={`#endpoint-${id}`}
                  className="block rounded px-2 py-1.5 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {action}
                </a>
              ))}
            </div>
            <a
              href="#errors"
              className="mt-5 block rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Error codes
            </a>
            <a
              href="#examples"
              className="block rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Code examples
            </a>
          </nav>
        </aside>

        <article className="min-w-0">
          <div className="mb-6 mt-7 flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">
              Home
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">API reference</span>
          </div>

          <div className="mb-8 border-b border-border pb-7">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
              <BookOpen className="h-4 w-4" /> API reference{" "}
              <span className="text-muted-foreground">/</span> v1
            </div>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Numbers API</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Purchase a number, poll for a verification SMS, and manage its order from your
              application.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded border border-border bg-card px-2 py-1 font-mono text-foreground">
                GET /api/v1
              </span>
              <span className="rounded border border-border px-2 py-1 text-muted-foreground">
                Query parameters
              </span>
              <span className="rounded border border-border px-2 py-1 text-muted-foreground">
                30 requests / second
              </span>
            </div>
          </div>

          <nav
            aria-label="API documentation sections"
            className="mb-6 flex gap-2 overflow-x-auto border-b border-border pb-4 lg:hidden"
          >
            {[
              ["quick-start", "Quick start"],
              ["endpoints", "Endpoints"],
              ["errors", "Error codes"],
              ["examples", "Code examples"],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="shrink-0 rounded border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>

          {/* Key + Authentication + Base URL */}
          <div id="authentication" className="mb-9 scroll-mt-24 space-y-6 border-b border-border pb-8">
            {/* Notice Banner */}
            {notice && (
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-400">
                <span className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  {notice}
                </span>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  className="text-emerald-400/80 hover:text-emerald-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Main API Key Card */}
            <div className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Key className="h-4 w-4" />
                    </span>
                    <h2 className="text-base font-semibold text-foreground">Your API Key</h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Keep this secret — use it in all API requests via the{" "}
                    <code className="font-mono text-foreground">api_key</code> query parameter.
                  </p>
                </div>

                {/* Balance Badge */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-400">
                    <Wallet className="h-3.5 w-3.5" />
                    <span>Balance:</span>
                    <span className="font-mono font-semibold">
                      {loadingKey ? "..." : apiKeyData ? apiKeyData.balanceFormatted : "₹0.00"}
                    </span>
                    {apiKeyData?.unlimited && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                        UNLIMITED
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Secret Key Display Box */}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex flex-1 items-center rounded-lg border border-[#263932] bg-[#14211c] px-3.5 py-2.5 font-mono text-xs sm:text-sm text-[#e0ebe4]">
                  <span className="flex-1 truncate tracking-wider">
                    {loadingKey ? "Loading key..." : displayedKey}
                  </span>
                  <div className="flex items-center gap-1.5 ml-2">
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      title={showKey ? "Hide API key" : "Show API key"}
                      className="rounded p-1 text-[#a5b9ad] transition hover:bg-white/10 hover:text-white"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      title="Copy API key"
                      className="flex items-center gap-1 rounded bg-white/10 px-2.5 py-1 text-xs font-sans text-white transition hover:bg-white/20"
                    >
                      {copiedKey ? (
                        <>
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Action Buttons Row */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    Label:{" "}
                    <strong className="font-medium text-foreground">
                      {apiKeyData?.label || "Live API Key"}
                    </strong>
                  </span>
                  <span>•</span>
                  <span>
                    Owner:{" "}
                    <strong className="font-medium text-foreground">
                      {apiKeyData?.ownerEmail || "Default Account"}
                    </strong>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleTopUp(100)}
                    disabled={toppingUp || loadingKey || !apiKeyData}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {toppingUp ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    <span>+ ₹100 Test Credits</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowGenModal(true)}
                    disabled={loadingKey}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-accent px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent/80"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span>Generate New Key</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Base URL & Rate Limit 2-Col Grid */}
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  Base URL
                </div>
                <CodeBlock
                  code={`${origin}/api/v1`}
                  lang="ENDPOINT"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  Rate Limiting
                </div>
                <div className="rounded-md border border-border bg-card p-3 text-xs leading-5 text-muted-foreground">
                  <p className="font-medium text-foreground">30 requests per second per API key</p>
                  <p className="mt-1">
                    When exceeded, returns HTTP{" "}
                    <code className="rounded bg-accent px-1 font-mono text-[11px] text-foreground">429</code>{" "}
                    with <code className="rounded bg-accent px-1 font-mono text-[11px] text-foreground">Retry-After</code>{" "}
                    header.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Start */}
          <div id="quick-start" className="mb-10 scroll-mt-20 border-b border-border pb-8">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
              <Code2 className="h-4 w-4 text-primary" />
              Quick Start
            </h2>
            <ol className="space-y-2.5">
              {[
                {
                  n: "1",
                  t: "Call getBalance",
                  d: "Verify your API key and check available wallet credits.",
                },
                {
                  n: "2",
                  t: "Call getNumber directly",
                  d: "Randomly assigns and purchases an available verified unregistered WhatsApp Indian number (₹49). No phone, country, or service parameters are needed.",
                },
                {
                  n: "3",
                  t: "Poll getStatus every 3–5s",
                  d: "Keep polling with order ID until STATUS_OK:<otp> or STATUS_CANCEL is returned.",
                },
                {
                  n: "4",
                  t: "Use setStatus=8 to cancel",
                  d: "If you want to cancel, request cancellation after 2 minutes to get an immediate ₹49 refund.",
                },
                {
                  n: "5",
                  t: "Call regetNumber for new OTP",
                  d: "For finished/closed orders with SMS, call regetNumber to get another OTP on the same number.",
                },
              ].map((s) => (
                <li key={s.n} className="flex items-start gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {s.n}
                  </span>
                  <div>
                    <span className="font-medium">{s.t}</span>
                    <span className="text-muted-foreground"> — {s.d}</span>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Example flow (curl)
              </h3>
              <CodeBlock
                lang="bash"
                code={`# 1. Check wallet balance
curl "${origin}/api/v1?action=getBalance&api_key=${activeKey}"
# → ACCESS_BALANCE:150.00

# 2. Buy a WhatsApp number directly (no service/country params needed)
curl "${origin}/api/v1?action=getNumber&api_key=${activeKey}"
# → ACCESS_NUMBER:AbCdEf123456:919876543210

# 3. Poll for OTP (every 3-5 seconds)
curl "${origin}/api/v1?action=getStatus&api_key=${activeKey}&id=AbCdEf123456"
# → STATUS_WAIT_CODE  (keep polling)
# → STATUS_OK:<#> 265421 is your mobile verification code...

# 4. (Optional) Get a new OTP on the same number after completion
curl "${origin}/api/v1?action=regetNumber&api_key=${activeKey}&id=AbCdEf123456"
# → REGET_NUMBER_OK:NewOrderId456:919876543210`}
              />
            </div>
          </div>

          {/* Endpoints */}
          <h2 id="endpoints" className="mb-4 scroll-mt-20 text-xl font-semibold">
            Endpoints
          </h2>
          <div className="divide-y divide-border">
            <Endpoint
              apiKey={activeKey}
              baseUrl={`${origin}/api/v1`}
              action="getBalance"
              title="Check wallet balance"
              desc="Returns your current credit balance. Use this to verify your API key is valid before making purchases."
              params={[]}
              responses={[
                { label: "Example", value: "ACCESS_BALANCE:150.00" },
                { label: "Zero balance", value: "ACCESS_BALANCE:0.00" },
              ]}
              note="Balance is in INR with 2 decimal places. Each number purchase costs ₹49."
            />

            <Endpoint
              apiKey={activeKey}
              baseUrl={`${origin}/api/v1`}
              action="getNumber"
              title="Purchase a verified unregistered number directly"
              desc="Randomly assigns an available unregistered WhatsApp Indian number and starts an SMS session. No phone, service, or country parameter is accepted. ₹49 is deducted immediately. Number expires after 15 minutes if no OTP is received."
              params={[]}
              responses={[
                { label: "Success", value: "ACCESS_NUMBER:AbCdEf123456:919876543210" },
                { label: "Format", value: "ACCESS_NUMBER:<order_id>:<phoneNumber>" },
                { label: "No numbers", value: "NO_NUMBER" },
                { label: "No balance", value: "NO_BALANCE" },
              ]}
              note="Format is ACCESS_NUMBER:orderId:phoneNumber. Save the order_id to poll getStatus or cancel with setStatus."
            />

            <Endpoint
              apiKey={activeKey}
              baseUrl={`${origin}/api/v1`}
              action="getNumberV2"
              title="Purchase a number (JSON variant)"
              desc="JSON variant of getNumber. Same direct purchase flow without service/country parameters, but returns structured JSON."
              params={[]}
              responses={[
                {
                  label: "Success",
                  value: JSON.stringify(
                    {
                      status: "OK",
                      order_id: "AbCdEf123456",
                      number: "919876543210",
                      service: "WhatsApp",
                      service_code: "whatsapp",
                      country: "India",
                      country_code: "22",
                      price: 49,
                    },
                    null,
                    2,
                  ),
                },
                {
                  label: "Error",
                  value: JSON.stringify({ status: "ERROR", error: "NO_NUMBER" }, null, 2),
                },
              ]}
              note="Content-Type: application/json. order_id is used for getStatus/setStatus."
            />

            <Endpoint
              apiKey={activeKey}
              baseUrl={`${origin}/api/v1`}
              action="getStatus"
              title="Check order status and retrieve OTP"
              desc="Poll this endpoint every 3–5 seconds to retrieve the SMS OTP content."
              params={[
                {
                  name: "id",
                  value: "AbCdEf123456",
                  desc: "Order ID from getNumber",
                  optional: false,
                },
              ]}
              responses={[
                { label: "Waiting", value: "STATUS_WAIT_CODE" },
                {
                  label: "SMS Received",
                  value: "STATUS_OK:<#> 265421 is your mobile verification code...",
                },
                { label: "Cancelled/Expired", value: "STATUS_CANCEL" },
              ]}
              note="Keep polling until you get STATUS_OK or STATUS_CANCEL. The verification code follows the colon after STATUS_OK."
            />

            <Endpoint
              apiKey={activeKey}
              baseUrl={`${origin}/api/v1`}
              action="setStatus"
              title="Cancel order or request next SMS"
              desc="Cancel an order (status=8) for a ₹49 refund, or request next SMS (status=3) for multi-SMS support."
              params={[
                { name: "id", value: "AbCdEf123456", desc: "Order ID", optional: false },
                {
                  name: "status",
                  value: "8",
                  desc: "8 = cancel & refund, 3 = request next SMS",
                  optional: false,
                },
              ]}
              responses={[
                { label: "Cancelled", value: "STATUS_CANCEL" },
                { label: "Next SMS queued", value: "ACCESS_RETRY_GET" },
                { label: "Too early (wait 2 min)", value: "EARLY_CANCEL_DENIED:95" },
                { label: "Already has SMS", value: "ACCESS_ACTIVATION" },
              ]}
              note="Cannot cancel within 2 minutes of purchase. After 2 minutes, cancel any time to refund ₹49. status=3 only works after SMS is received."
            />

            <Endpoint
              apiKey={activeKey}
              baseUrl={`${origin}/api/v1`}
              action="regetNumber"
              title="Get a new OTP on the same phone number"
              desc="Reactivates the phone number for another OTP session. Only works on finished/closed orders with SMS."
              params={[
                {
                  name: "id",
                  value: "AbCdEf123456",
                  desc: "Order ID from completed closed order",
                  optional: false,
                },
              ]}
              responses={[
                { label: "Success", value: "REGET_NUMBER_OK:NewOrderId456:919876543210" },
                { label: "Order still active", value: "NUMBER_STILL_ACTIVE" },
                { label: "Order not found", value: "NO_ACTIVATION" },
                { label: "No SMS received yet", value: "BAD_ACTION" },
                { label: "Insufficient balance", value: "NO_BALANCE" },
                { label: "Provider error", value: "ERROR" },
              ]}
              note="Only works on COMPLETED + CLOSED orders. Use the new orderId to check SMS status. Charges ₹49."
            />
          </div>

          {/* Error codes */}
          <div id="errors" className="mt-10 scroll-mt-24 border-y border-border">
            <div className="border-b border-border py-4">
              <h2 className="text-lg font-semibold">Error codes</h2>
            </div>
            <div className="divide-y divide-border">
              {ERROR_CODES.map((e) => (
                <div key={e.code} className="grid gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
                  <code className="w-fit font-mono text-xs font-medium text-destructive">
                    {e.code}
                  </code>
                  <span className="text-sm text-muted-foreground">{e.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Code examples */}
          <div id="examples" className="mt-10 scroll-mt-24 space-y-6">
            <div className="border-b border-border pb-3">
              <p className="text-xs font-semibold uppercase text-primary">Examples</p>
              <h2 className="mt-1 text-xl font-semibold">Code examples</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each example buys a number and polls until the order finishes.
              </p>
            </div>

            <div className="flex w-fit max-w-full gap-1 overflow-x-auto border-b border-border">
              {(
                [
                  ["python", "Python"],
                  ["javascript", "JavaScript"],
                  ["php", "PHP"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setExampleLang(value)}
                  aria-pressed={exampleLang === value}
                  className={`border-b-2 px-3 py-2 text-xs font-medium transition ${
                    exampleLang === value
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {exampleLang === "python" && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Python</h3>
                <CodeBlock
                  lang="python"
                  code={`import requests, time

API_KEY = "${activeKey}"
BASE = "${origin}/api/v1"

def call(action, **params):
    r = requests.get(BASE, params={"action": action, "api_key": API_KEY, **params})
    return r.text.strip()

# 1. Buy a number directly (no service/country required)
resp = call("getNumber")
_, order_id, phone = resp.split(":")
print(f"Got number: +{phone}, Order: {order_id}")

# 2. Poll for OTP
for _ in range(60):
    status = call("getStatus", id=order_id)
    if status.startswith("STATUS_OK:"):
        otp = status.split("STATUS_OK:")[1]
        print(f"OTP received: {otp}")
        break
    if status == "STATUS_CANCEL":
        print("Order cancelled or expired")
        break
    time.sleep(4)
`}
                />
              </div>
            )}

            {exampleLang === "javascript" && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                  JavaScript / Node.js
                </h3>
                <CodeBlock
                  lang="javascript"
                  code={`const API_KEY = "${activeKey}";
const BASE = "${origin}/api/v1";

async function call(action, params = {}) {
  const url = new URL(BASE);
  url.searchParams.set("action", action);
  url.searchParams.set("api_key", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  return res.text();
}

// 1. Buy a number directly
const resp = await call("getNumber");
const [, orderId, phone] = resp.split(":");
console.log(\`Got number: +\${phone}, Order: \${orderId}\`);

// 2. Poll for OTP
let otp = null;
for (let i = 0; i < 60; i++) {
  const status = await call("getStatus", { id: orderId });
  if (status.startsWith("STATUS_OK:")) {
    otp = status.slice("STATUS_OK:".length);
    console.log("OTP:", otp);
    break;
  }
  if (status === "STATUS_CANCEL") { console.log("Expired"); break; }
  await new Promise(r => setTimeout(r, 4000));
}
`}
                />
              </div>
            )}

            {exampleLang === "php" && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">PHP</h3>
                <CodeBlock
                  lang="php"
                  code={`<?php
$API_KEY = "${activeKey}";
$BASE = "${origin}/api/v1";

function call($action, $params = []) {
    global $API_KEY, $BASE;
    $qs = http_build_query(array_merge(["action" => $action, "api_key" => $API_KEY], $params));
    return trim(file_get_contents("$BASE?$qs"));
}

// 1. Buy a number directly
$resp = call("getNumber");
[$_, $orderId, $phone] = explode(":", $resp, 3);
echo "Got: +$phone (order $orderId)\\n";

// 2. Poll OTP
for ($i = 0; $i < 60; $i++) {
    $status = call("getStatus", ["id" => $orderId]);
    if (str_starts_with($status, "STATUS_OK:")) {
        echo "OTP: " . substr($status, 10) . "\\n";
        break;
    }
    if ($status === "STATUS_CANCEL") { echo "Expired\\n"; break; }
    sleep(4);
}
`}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted-foreground">
            <p>Browse available numbers in the marketplace.</p>
            <Link
              to="/numbers"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Numbers Marketplace
            </Link>
          </div>
        </article>
      </div>

      {/* Generate Key Modal */}
      {showGenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                Generate New API Key
              </div>
              <button
                type="button"
                onClick={() => setShowGenModal(false)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
              Create a fresh secret API key. Each new key comes with ₹200 free starting balance.
            </p>

            <form onSubmit={handleGenerateKey} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground">
                  Account Email (optional)
                </label>
                <input
                  type="email"
                  value={customEmail}
                  onChange={(e) => setCustomEmail(e.target.value)}
                  placeholder="developer@yourdomain.com"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground">
                  Key Label / Description (optional)
                </label>
                <input
                  type="text"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="e.g. Production WhatsApp Bot"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGenModal(false)}
                  className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {generating ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>Generate Key</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
