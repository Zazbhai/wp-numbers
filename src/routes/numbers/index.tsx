import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  Clock3,
  Code2,
  Copy,
  Infinity as InfinityIcon,
  Key,
  LogOut,
  WalletCards,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  listMarketplaceNumbers,
  buyMarketplaceNumber,
  topUpUserWallet,
  checkSmsOtp,
  cancelPurchase,
  type MarketplaceNumberItem,
} from "@/lib/wa-check.functions";
import { getLocalAuthSession, signOutLocal } from "@/lib/auth.functions";

export const Route = createFileRoute("/numbers/")({
  head: () => ({
    meta: [
      { title: "WhatsApp Numbers | Marketplace" },
      {
        name: "description",
        content:
          "Buy verified unregistered WhatsApp numbers. Receive live SMS OTP directly on screen.",
      },
    ],
  }),
  component: NumbersMarketplace,
});

function NumbersMarketplace() {
  const [stats, setStats] = useState({
    totalAvailable: 0,
    pendingChecking: 0,
    furySmsBalance: null as number | null,
    monitorActive: false,
    payment: { enabled: false, testingMode: false, upiId: "", merchantName: "" },
    walletBalance: 0,
    walletUnlimited: false,
    walletTransactions: [] as {
      id: string;
      type: string;
      amount: number;
      description: string;
      createdAt: string;
    }[],
  });
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<Pick<
    MarketplaceNumberItem,
    "phone" | "formattedPhone"
  > | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [otpState, setOtpState] = useState<"idle" | "waiting" | "received" | "cancelled">("idle");
  const [otpCode, setOtpCode] = useState<string | null>(null);
  const [otpPollCount, setOtpPollCount] = useState(0);
  const [notice, setNotice] = useState("");
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState(245);
  const [topUpUtr, setTopUpUtr] = useState("");
  const [topUpBusy, setTopUpBusy] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await listMarketplaceNumbers();
      if (res.ok) {
        setStats({
          totalAvailable: res.stats.totalAvailable,
          pendingChecking: res.stats.pendingChecking,
          furySmsBalance: res.stats.furySmsBalance ?? null,
          monitorActive: res.stats.monitorActive,
          payment: res.stats.payment,
          walletBalance: res.stats.walletBalance,
          walletUnlimited: Boolean(res.stats.walletUnlimited),
          walletTransactions: res.stats.walletTransactions,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getLocalAuthSession().then((session) => {
      if (!mounted) return;
      setIsAuthenticated(Boolean(session));
      setAuthReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    loadData();
    const interval = setInterval(loadData, 8000);
    return () => clearInterval(interval);
  }, [authReady, isAuthenticated, loadData]);

  // SMS Poller when a number is selected for purchase
  useEffect(() => {
    if (!isAuthenticated || !selectedNumber || otpState !== "waiting") return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await checkSmsOtp({ data: { phone: selectedNumber.phone } });
        if (cancelled) return;
        setOtpPollCount((prev) => prev + 1);

        if (res.ok && res.state === "OK" && res.code) {
          setOtpCode(res.code);
          setOtpState("received");
          loadData();
        } else if (!res.ok && res.state === "CANCELLED") {
          setNotice(res.error || "The SMS request was cancelled.");
          setOtpState("cancelled");
        }
      } catch (err) {
        console.error(err);
      }
    };

    poll();
    const timer = setInterval(poll, 3500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated, selectedNumber, otpState, loadData]);

  function handleBuy() {
    if (!isAuthenticated) return;
    setSelectedNumber(null);
    setCheckoutOpen(true);
    setBuying(false);
    setOtpState("idle");
    setOtpCode(null);
    setOtpPollCount(0);
    setNotice("");
  }

  async function purchaseNumber() {
    if (
      !isAuthenticated ||
      !checkoutOpen ||
      (!stats.walletUnlimited && stats.walletBalance < 49)
    )
      return;
    setBuying(true);
    setNotice("");
    const res = await buyMarketplaceNumber({ data: {} });
    setBuying(false);
    if (res.ok) {
      setSelectedNumber({ phone: res.phone, formattedPhone: res.formattedPhone });
      setOtpState("waiting");
      setStats((current) => ({
        ...current,
        walletBalance: res.walletBalance,
        walletUnlimited: Boolean(res.walletUnlimited ?? current.walletUnlimited),
      }));
    } else {
      setNotice(res.error || "Could not select this number.");
      setOtpState("idle");
      loadData();
    }
  }

  async function submitTopUp() {
    if (
      !isAuthenticated ||
      (!stats.payment.testingMode && (!stats.payment.enabled || !topUpUtr.trim()))
    )
      return;
    setTopUpBusy(true);
    setNotice("");
    const result = await topUpUserWallet({
      data: {
        amount: topUpAmount,
        ...(stats.payment.testingMode ? {} : { utr: topUpUtr.trim() }),
      },
    });
    setTopUpBusy(false);
    if (!result.ok) {
      setNotice(result.error || "Could not top up wallet.");
      return;
    }
    setStats((current) => ({ ...current, walletBalance: result.balance }));
    setTopUpOpen(false);
    setTopUpUtr("");
    loadData();
  }

  async function handleCancelPurchase() {
    if (!selectedNumber) {
      setCheckoutOpen(false);
      return;
    }
    if (otpState === "waiting" || otpState === "received") {
      const result = await cancelPurchase({ data: { phone: selectedNumber.phone } });
      setNotice(
        result.ok
          ? "Request cancelled. ₹49 was returned to your wallet."
          : result.error || "Could not cancel this request.",
      );
      setOtpState("cancelled");
      loadData();
      return;
    }
    setSelectedNumber(null);
    setOtpState("idle");
    setOtpCode(null);
    loadData();
  }

  async function handleSignOut() {
    try {
      await signOutLocal();
    } catch (error) {
      console.error("[signOutLocal error]:", error);
    } finally {
      setIsAuthenticated(false);
      setSelectedNumber(null);
      setCheckoutOpen(false);
      setOtpCode(null);
      setOtpState("idle");
    }
  }

  if (!authReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f7f5] px-5 text-[#202a27]">
        <p className="text-sm text-[#596762]">Checking your account...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f7f5] px-5 py-12 text-[#202a27]">
        <section className="w-full max-w-md border-t-2 border-[#174c3e] pt-6">
          <Link to="/" className="text-sm font-semibold text-[#174c3e]">
            WhatsApp Numbers
          </Link>
          <h1 className="mt-8 text-3xl font-semibold">Sign in to continue</h1>
          <p className="mt-3 text-sm leading-6 text-[#596762]">
            Sign in to view available numbers and request a verification code.
          </p>
          <Link
            to="/login"
            search={{ redirect: "/numbers" }}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#174c3e] px-4 text-sm font-medium text-white transition hover:bg-[#123e33]"
          >
            Sign in <ArrowRight className="size-4" />
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f7f5] text-[#202a27]">
      {/* Header */}
      <header className="mx-auto flex max-w-7xl items-center justify-between border-b border-[#dce2dd] px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2 text-base font-semibold">
          <span className="grid size-8 place-items-center rounded-md bg-[#174c3e] text-sm font-bold text-white">
            W
          </span>
          <span>WhatsApp Numbers</span>
        </Link>
        <nav className="flex items-center gap-3 text-sm font-medium sm:gap-4">
          <Link
            to="/numbers/recent"
            className="inline-flex items-center gap-1.5 border border-[#ccd6cf] bg-white px-3 py-1.5 text-xs font-semibold text-[#174c3e] transition hover:bg-[#edf1ed]"
          >
            <Smartphone className="size-3.5" />
            <span>Recent numbers</span>
          </Link>
          <Link
            to="/api-docs"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#174c3e]/30 bg-[#174c3e]/10 px-3 py-1.5 text-xs font-semibold text-[#174c3e] transition hover:bg-[#174c3e]/15"
          >
            <Key className="size-3.5" />
            <span>API Key & Docs</span>
          </Link>
          <button
            onClick={handleSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="grid size-9 place-items-center rounded-md border border-[#ccd6cf] bg-white text-[#34443d] transition hover:bg-[#edf1ed]"
          >
            <LogOut className="size-4" />
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            title="Refresh number list"
            aria-label="Refresh number list"
            className="grid size-9 place-items-center rounded-md border border-[#ccd6cf] bg-white text-[#34443d] transition hover:bg-[#edf1ed] disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-7xl px-5 pt-10 pb-6 sm:px-8">
        <div className="flex flex-col gap-6 border-b border-[#dce2dd] pb-7 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-[#26745b]">Marketplace</p>
            <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Available numbers</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#596762]">
              Unregistered numbers are assigned at random from live inventory.
            </p>
          </div>

          <div className="flex items-center gap-4 border-y border-[#dce2dd] py-2 md:border-y-0">
            <div className="flex items-center gap-2">
              <WalletCards className="size-4 text-[#26745b]" />
              <div>
                <p className="text-xs text-[#65716c]">Wallet</p>
                {stats.walletUnlimited ? (
                  <p className="flex items-center gap-1 font-bold text-emerald-700">
                    <InfinityIcon className="size-3.5" /> Unlimited
                  </p>
                ) : (
                  <p className="font-semibold tabular-nums">₹{stats.walletBalance.toFixed(2)}</p>
                )}
              </div>
            </div>
            {!stats.walletUnlimited && (
              <button
                onClick={() => setTopUpOpen(true)}
                className="inline-flex min-h-9 items-center gap-1.5 border border-[#ccd6cf] bg-white px-3 text-xs font-semibold text-[#174c3e] hover:bg-[#edf1ed]"
              >
                <WalletCards className="size-3.5" /> Add funds
              </button>
            )}
            <span className="hidden border-l border-[#dce2dd] pl-4 sm:block">
              <div className="min-w-28 py-2 pr-5">
                <p className="text-xs text-[#65716c]">Available</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-[#202a27]">
                  {stats.totalAvailable}
                </p>
              </div>
              <div className="min-w-28 px-5 py-2">
                <p className="text-xs text-[#65716c]">Being checked</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-[#26745b]">
                  {stats.pendingChecking}
                </p>
              </div>
            </span>
          </div>
        </div>
      </section>

      {/* Numbers Grid */}
      <section className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
        {loading ? (
          <div className="rounded-2xl border border-[#dbe4df] bg-white p-12 text-center">
            <RefreshCw className="mx-auto size-8 animate-spin text-[#477c68]" />
            <p className="mt-3 text-sm text-[#596762]">Loading numbers…</p>
          </div>
        ) : stats.totalAvailable === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#cbd7d1] bg-white/60 p-12 text-center">
            <Smartphone className="mx-auto size-10 text-[#64766f]" />
            <h3 className="mt-3 text-lg font-semibold text-[#132d27]">
              No numbers available right now
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-[#596762]">
              Check back shortly, or refresh the inventory.
            </p>
            <button
              onClick={loadData}
              disabled={loading}
              className="mt-5 inline-flex items-center gap-2 rounded-md border border-[#ccd6cf] bg-white px-4 py-2.5 text-sm font-medium text-[#202a27] transition hover:bg-[#edf1ed] disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh list
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-5 border-y border-[#dce2dd] py-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center border border-[#cbd7d1] bg-white text-[#26745b]">
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <p className="font-semibold text-[#132d27]">India · +91</p>
                  <p className="mt-1 text-xs text-[#64766f]">
                    {stats.totalAvailable} available · ₹49 per request
                  </p>
                </div>
              </div>
              <button
                onClick={handleBuy}
                className="inline-flex min-h-10 items-center gap-2 bg-[#174c3e] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#21634f]"
              >
                Buy random number
                <ArrowRight className="size-4" />
              </button>
            </div>

          </>
        )}
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-12 sm:px-8">
        <h2 className="text-lg font-semibold">Getting a verification code</h2>
        <div className="mt-4 grid gap-5 border-t border-[#dce2dd] pt-4 sm:grid-cols-3">
          <div>
            <div className="grid size-7 place-items-center rounded-md bg-[#dcebe3] text-sm font-semibold text-[#174c3e]">
              1
            </div>
            <h3 className="mt-3 text-sm font-semibold">Get an assigned number</h3>
            <p className="mt-1 text-sm text-[#596762]">
              One available number is assigned after payment verification.
            </p>
          </div>
          <div>
            <div className="grid size-7 place-items-center rounded-md bg-[#dcebe3] text-sm font-semibold text-[#174c3e]">
              2
            </div>
            <h3 className="mt-3 text-sm font-semibold">Request the code</h3>
            <p className="mt-1 text-sm text-[#596762]">
              Enter the number in WhatsApp and request an SMS. Keep this page open.
            </p>
          </div>
          <div>
            <div className="grid size-7 place-items-center rounded-md bg-[#dcebe3] text-sm font-semibold text-[#174c3e]">
              3
            </div>
            <h3 className="mt-3 text-sm font-semibold">Enter the code</h3>
            <p className="mt-1 text-sm text-[#596762]">
              The code appears here when the SMS arrives. Use it promptly.
            </p>
          </div>
        </div>
      </section>

      {/* Buy / OTP Modal */}
      {(checkoutOpen || selectedNumber) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-[#cbd7d1]">
            <button
              onClick={() => {
                if (!selectedNumber || otpState === "received") {
                  setSelectedNumber(null);
                  setCheckoutOpen(false);
                } else {
                  handleCancelPurchase();
                }
              }}
              className="absolute right-4 top-4 rounded-lg p-1 text-[#64766f] hover:bg-[#edf5f0] hover:text-[#132d27]"
            >
              <X className="size-5" />
            </button>

            <div className="flex items-center gap-2 text-xs font-medium text-[#386451]">
              <Smartphone className="size-4" />
              <span>Number request</span>
            </div>

            <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#132d27]">
              {selectedNumber?.formattedPhone ?? "Random number · assignment pending"}
            </h2>

            {notice && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                {notice}
              </div>
            )}

            {/* Step 1: Copy Phone */}
            {otpState === "idle" && (
              <section className="mt-4 border-y border-[#e2ece7] py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#64766f]">Wallet balance</p>
                    {stats.walletUnlimited ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xl font-bold text-emerald-700">
                        <InfinityIcon className="size-5" /> Unlimited
                      </p>
                    ) : (
                      <p className="mt-1 text-xl font-semibold tabular-nums text-[#132d27]">
                        ₹{stats.walletBalance.toFixed(2)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-[#718078]">
                      {stats.walletUnlimited
                        ? "Unlimited balance active (free purchases)"
                        : "₹49 per random number"}
                    </p>
                  </div>
                  {!stats.walletUnlimited && stats.walletBalance < 49 ? (
                    <button
                      onClick={() => {
                        setCheckoutOpen(false);
                        setTopUpOpen(true);
                      }}
                      className="border border-[#cbd7d1] px-3 py-2 text-xs font-semibold text-[#174c3e]"
                    >
                      Add funds
                    </button>
                  ) : null}
                </div>
                <button
                  onClick={() => void purchaseNumber()}
                  disabled={buying || (!stats.walletUnlimited && stats.walletBalance < 49)}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 bg-[#174c3e] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {buying
                    ? "Assigning number..."
                    : !stats.walletUnlimited && stats.walletBalance < 49
                      ? "Top up to continue"
                      : stats.walletUnlimited
                        ? "Buy random number · Free (Unlimited)"
                        : "Buy random number · ₹49"}
                  <ArrowRight className="size-4" />
                </button>
                <p className="mt-2 text-[11px] leading-4 text-[#718078]">
                  Failed activations and cancelled requests return the charge to your wallet.
                </p>

              </section>
            )}

            {selectedNumber ? (
              <div className="mt-4 rounded-xl bg-[#f5f8f6] p-4 border border-[#e2ece7]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[#64766f]">Step 1: Copy phone number</p>
                    <p className="font-mono text-lg font-bold text-[#132d27]">
                      {selectedNumber.phone}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedNumber.phone);
                      setCopiedPhone(true);
                      setTimeout(() => setCopiedPhone(false), 2000);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-[#cbd7d1] bg-white px-3 py-1.5 text-xs font-semibold text-[#132d27] hover:bg-[#edf5f0]"
                  >
                    {copiedPhone ? (
                      <Check className="size-3.5 text-[#10b981]" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copiedPhone ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-[#52665f]">
                  Open WhatsApp, enter this number and request SMS verification.
                </p>
              </div>
            ) : null}

            {/* Step 2: Live OTP Box */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-[#64766f] mb-2">
                Step 2: Live WhatsApp OTP Code
              </p>

              {buying && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#285744] bg-[#edf5f0] p-6 text-center">
                  <RefreshCw className="size-8 text-[#285744] animate-spin mb-3" />
                  <p className="font-semibold text-sm text-[#202a27]">Starting your request…</p>
                </div>
              )}

              {!buying && otpState === "waiting" && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#285744] bg-[#edf5f0] p-6 text-center">
                  <div className="relative mb-3 flex size-12 items-center justify-center">
                    <RefreshCw className="size-6 text-[#285744] animate-spin" />
                  </div>
                  <p className="font-semibold text-sm text-[#132d27]">
                    Waiting for the SMS code...
                  </p>
                  <p className="mt-1 text-xs text-[#52665f]">
                    Checking for a new message. Check {otpPollCount}.
                  </p>
                </div>
              )}

              {otpState === "received" && otpCode && (
                <div className="rounded-xl border-2 border-[#10b981] bg-[#eefaf4] p-5 text-center">
                  <div className="inline-flex items-center gap-1 rounded-full bg-[#d1fae5] px-3 py-1 text-xs font-bold text-[#065f46] mb-2">
                    <Check className="size-3.5" /> Code received
                  </div>
                  <div className="my-2 font-mono text-4xl font-extrabold tracking-widest text-[#065f46]">
                    {otpCode}
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(otpCode);
                      setCopiedOtp(true);
                      setTimeout(() => setCopiedOtp(false), 2000);
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#15392f] px-4 py-2 text-xs font-bold text-white hover:bg-[#285744]"
                  >
                    {copiedOtp ? (
                      <Check className="size-3.5 text-[#10b981]" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copiedOtp ? "Copied" : "Copy code"}
                  </button>
                  <p className="mt-3 text-xs text-[#065f46]">
                    Enter this code in WhatsApp to continue.
                  </p>
                </div>
              )}

              {otpState === "cancelled" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-xs text-amber-800">
                  {notice || "No code arrived. This number is available in the marketplace again."}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="mt-6 flex items-center justify-between border-t border-[#e2ece7] pt-4">
              {otpState === "waiting" ? (
                <button
                  onClick={handleCancelPurchase}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Cancel request
                </button>
              ) : (
                <span />
              )}

              <button
                onClick={() => {
                  setSelectedNumber(null);
                  setCheckoutOpen(false);
                  loadData();
                }}
                className="rounded-lg bg-[#15392f] px-5 py-2 text-xs font-semibold text-white hover:bg-[#285744]"
              >
                {otpState === "received" ? "Done" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
      {topUpOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <section className="w-full max-w-md border border-[#d7dfd9] bg-white p-5 text-[#202a27] shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-[#26745b]">Wallet</p>
                <h2 className="mt-1 text-xl font-semibold">Add funds</h2>
                <p className="mt-1 text-sm text-[#64766f]">
                  Current balance: ₹{stats.walletBalance.toFixed(2)}
                </p>
              </div>
              <button
                onClick={() => setTopUpOpen(false)}
                aria-label="Close wallet top-up"
                className="grid size-9 place-items-center border border-[#d7dfd9] text-[#64766f] hover:bg-[#f5f8f6]"
              >
                <X className="size-4" />
              </button>
            </div>
            {stats.payment.testingMode ? (
              <p className="mt-4 border-l-2 border-[#ad672c] bg-[#fff8ef] px-3 py-2 text-xs text-[#80501e]">
                Testing mode: credits are added without a payment.
              </p>
            ) : null}
            {notice ? (
              <p
                role="alert"
                className="mt-4 border-l-2 border-[#a5463c] bg-[#fff5f3] px-3 py-2 text-xs text-[#a5463c]"
              >
                {notice}
              </p>
            ) : null}
            <fieldset className="mt-5">
              <legend className="text-xs font-semibold text-[#52665f]">Top-up amount</legend>
              <div className="mt-2 flex gap-2">
                {[147, 245, 490].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setTopUpAmount(amount)}
                    aria-pressed={topUpAmount === amount}
                    className={`min-h-10 flex-1 border px-2 text-sm font-semibold tabular-nums ${topUpAmount === amount ? "border-[#174c3e] bg-[#edf5f0] text-[#174c3e]" : "border-[#cbd7d1] text-[#52665f] hover:bg-[#f8faf9]"}`}
                  >
                    ₹{amount}
                  </button>
                ))}
              </div>
            </fieldset>
            {stats.walletTransactions.length > 0 ? (
              <div className="mt-5 border-t border-[#e5ebe7] pt-3">
                <h3 className="text-xs font-semibold text-[#52665f]">Recent activity</h3>
                <div className="mt-2 divide-y divide-[#edf0ee]">
                  {stats.walletTransactions.slice(0, 4).map((transaction) => (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between gap-3 py-2 text-xs"
                    >
                      <span className="min-w-0 truncate text-[#64766f]">
                        {transaction.description}
                      </span>
                      <span
                        className={`shrink-0 font-semibold tabular-nums ${transaction.amount < 0 ? "text-[#a5463c]" : "text-[#386849]"}`}
                      >
                        {transaction.amount < 0 ? "−" : "+"}₹
                        {Math.abs(transaction.amount).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {!stats.payment.testingMode && stats.payment.enabled ? (
              <>
                <div className="mt-5 flex items-center justify-between border-y border-[#e5ebe7] py-3">
                  <div>
                    <p className="text-xs text-[#718078]">Pay to</p>
                    <p className="mt-1 text-sm font-semibold">{stats.payment.merchantName}</p>
                    <p className="font-mono text-sm text-[#52665f]">{stats.payment.upiId}</p>
                  </div>
                  <a
                    href={`upi://pay?pa=${encodeURIComponent(stats.payment.upiId)}&pn=${encodeURIComponent(stats.payment.merchantName)}&am=${topUpAmount}.00&cu=INR&tn=${encodeURIComponent("Wallet top-up")}`}
                    className="border border-[#cbd7d1] px-3 py-2 text-xs font-semibold text-[#174c3e] hover:bg-[#edf5f0]"
                  >
                    Pay by UPI
                  </a>
                </div>
                <label className="mt-4 block text-xs font-medium text-[#52665f]">
                  UTR / bank reference number
                  <input
                    value={topUpUtr}
                    onChange={(event) => setTopUpUtr(event.target.value)}
                    autoComplete="off"
                    inputMode="text"
                    placeholder="Enter the UTR from your payment receipt"
                    className="mt-1.5 w-full border border-[#cbd7d1] px-3 py-2.5 font-mono text-sm outline-none focus:border-[#26745b]"
                  />
                </label>
              </>
            ) : null}
            {!stats.payment.testingMode && !stats.payment.enabled ? (
              <p className="mt-4 text-sm text-[#a5463c]">
                Wallet top-ups are unavailable right now.
              </p>
            ) : null}
            <button
              onClick={() => void submitTopUp()}
              disabled={
                topUpBusy ||
                (!stats.payment.testingMode && (!stats.payment.enabled || !topUpUtr.trim()))
              }
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 bg-[#174c3e] px-4 text-sm font-semibold text-white hover:bg-[#21634f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {topUpBusy
                ? "Verifying..."
                : stats.payment.testingMode
                  ? `Add ₹${topUpAmount} test credit`
                  : `Verify and add ₹${topUpAmount}`}
              <ArrowRight className="size-4" />
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
