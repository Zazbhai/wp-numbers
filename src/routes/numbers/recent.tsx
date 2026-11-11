import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Clock3,
  Copy,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getLocalAuthSession } from "@/lib/auth.functions";
import {
  cancelPurchase,
  checkSmsOtp,
  listRecentNumbers,
  rebuyRecentNumber,
} from "@/lib/wa-check.functions";

export const Route = createFileRoute("/numbers/recent")({
  head: () => ({ meta: [{ title: "Recent numbers | WhatsApp Numbers" }] }),
  component: RecentNumbersPage,
});

type RecentNumber = {
  phone: string;
  formattedPhone: string;
  purchasedAt: string;
  status: string;
  canRebuy: boolean;
};

function RecentNumbersPage() {
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [numbers, setNumbers] = useState<RecentNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPhone, setBusyPhone] = useState("");
  const [message, setMessage] = useState("");
  const [activePhone, setActivePhone] = useState<RecentNumber | null>(null);
  const [otp, setOtp] = useState("");
  const [otpState, setOtpState] = useState<"waiting" | "received" | "cancelled" | "">("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await listRecentNumbers();
      if (result.ok) setNumbers(result.numbers);
    } catch (error) {
      console.error("[listRecentNumbers error]:", error);
      setMessage("Could not load your purchase history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getLocalAuthSession().then((session) => {
      if (!mounted) return;
      setAuthenticated(Boolean(session));
      setAuthReady(true);
      if (!session) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (authenticated) void refresh();
  }, [authenticated, refresh]);

  useEffect(() => {
    if (!activePhone || otpState !== "waiting") return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await checkSmsOtp({ data: { phone: activePhone.phone } });
        if (stopped) return;
        if (result.ok && result.state === "OK" && result.code) {
          setOtp(result.code);
          setOtpState("received");
          void refresh();
        } else if (!result.ok && result.state === "CANCELLED") {
          setOtpState("cancelled");
          setMessage(result.error || "This SMS request was cancelled.");
          void refresh();
        }
      } catch (error) {
        console.error("[recent number OTP poll error]:", error);
      }
    };
    void poll();
    const timer = setInterval(poll, 3500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [activePhone, otpState, refresh]);

  async function rebuy(number: RecentNumber) {
    setBusyPhone(number.phone);
    setMessage("");
    const result = await rebuyRecentNumber({ data: { phone: number.phone } });
    setBusyPhone("");
    if (!result.ok) {
      setMessage(result.error || "Could not rebuy this number.");
      void refresh();
      return;
    }
    setActivePhone(number);
    setOtp("");
    setOtpState("waiting");
    setMessage("Number reactivated. Waiting for the SMS code.");
    void refresh();
  }

  async function cancelActive() {
    if (!activePhone) return;
    const result = await cancelPurchase({ data: { phone: activePhone.phone } });
    setOtpState("cancelled");
    setMessage(
      result.ok
        ? "Request cancelled and the wallet charge was returned."
        : result.error || "Could not cancel request.",
    );
    void refresh();
  }

  async function copyOtp() {
    await navigator.clipboard.writeText(otp);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (!authReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f7f5] text-sm text-[#596762]">
        Checking your account...
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f7f5] px-5 text-[#202a27]">
        <section className="w-full max-w-md border-t-2 border-[#174c3e] pt-6">
          <Link to="/" className="text-sm font-semibold text-[#174c3e]">
            WhatsApp Numbers
          </Link>
          <h1 className="mt-8 text-3xl font-semibold">Sign in to view your numbers</h1>
          <p className="mt-3 text-sm leading-6 text-[#596762]">
            Your purchase history is private to your account.
          </p>
          <Link
            to="/login"
            search={{ redirect: "/numbers/recent" }}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 bg-[#174c3e] px-4 text-sm font-medium text-white hover:bg-[#123e33]"
          >
            Sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f7f5] text-[#202a27]">
      <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-[#dce2dd] px-5 py-4 sm:px-8">
        <Link
          to="/numbers"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#174c3e]"
        >
          <ArrowLeft className="size-4" /> Marketplace
        </Link>
        <button
          onClick={() => void refresh()}
          title="Refresh purchase history"
          aria-label="Refresh purchase history"
          className="grid size-9 place-items-center border border-[#ccd6cf] bg-white text-[#34443d] hover:bg-[#edf1ed]"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-9 sm:px-8">
        <div className="flex flex-col justify-between gap-4 border-b border-[#dce2dd] pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-[#26745b]">Account activity</p>
            <h1 className="mt-2 text-3xl font-semibold">Recent numbers</h1>
            <p className="mt-2 text-sm text-[#596762]">Numbers you have purchased, newest first.</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-[#596762]">
            <Smartphone className="size-4 text-[#26745b]" /> {numbers.length}{" "}
            {numbers.length === 1 ? "number" : "numbers"}
          </div>
        </div>

        {message ? (
          <p
            role="status"
            className="mt-5 border-l-2 border-[#26745b] bg-white px-4 py-3 text-sm text-[#34443d]"
          >
            {message}
          </p>
        ) : null}

        {activePhone && otpState ? (
          <section className="mt-6 border border-[#cbd7d1] bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#26745b]">
                  Active SMS request
                </p>
                <h2 className="mt-1 font-mono text-xl font-semibold">
                  {activePhone.formattedPhone}
                </h2>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#52665f]">
                {otpState === "waiting" ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" /> Waiting for code
                  </>
                ) : otpState === "received" ? (
                  <>
                    <Check className="size-4 text-[#26745b]" /> Code received
                  </>
                ) : (
                  "Request ended"
                )}
              </span>
            </div>
            {otp ? (
              <div className="mt-5 flex items-center justify-between border-y border-[#e5ebe7] py-4">
                <p className="font-mono text-3xl font-semibold tracking-wider">{otp}</p>
                <button
                  onClick={() => void copyOtp()}
                  title="Copy code"
                  aria-label="Copy code"
                  className="grid size-10 place-items-center border border-[#ccd6cf] text-[#174c3e] hover:bg-[#edf1ed]"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </button>
              </div>
            ) : null}
            {otpState === "waiting" ? (
              <button
                onClick={() => void cancelActive()}
                className="mt-4 border border-[#ccd6cf] px-3 py-2 text-sm font-medium text-[#52665f] hover:bg-[#f6f7f5]"
              >
                Cancel request
              </button>
            ) : null}
          </section>
        ) : null}

        <div className="mt-6 border-y border-[#dce2dd]">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-[#596762]">
              <LoaderCircle className="size-4 animate-spin" /> Loading purchase history...
            </div>
          ) : numbers.length === 0 ? (
            <div className="py-14 text-center">
              <Smartphone className="mx-auto size-8 text-[#64766f]" />
              <h2 className="mt-3 text-base font-semibold">No purchases yet</h2>
              <p className="mt-1 text-sm text-[#596762]">
                Your purchased numbers will appear here.
              </p>
              <Link
                to="/numbers"
                className="mt-5 inline-flex items-center gap-2 bg-[#174c3e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#21634f]"
              >
                Browse numbers <ArrowLeft className="size-4 rotate-180" />
              </Link>
            </div>
          ) : (
            numbers.map((number) => (
              <article
                key={number.phone}
                className="grid gap-4 border-b border-[#e5ebe7] py-5 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="font-mono text-lg font-semibold">{number.formattedPhone}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#64766f]">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="size-3.5" />{" "}
                      {number.purchasedAt
                        ? new Date(number.purchasedAt).toLocaleString()
                        : "Purchase date unavailable"}
                    </span>
                    <span className="capitalize">
                      Current status: {number.status.replaceAll("_", " ")}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => void rebuy(number)}
                  disabled={!number.canRebuy || Boolean(busyPhone) || otpState === "waiting"}
                  title={
                    number.canRebuy
                      ? "Reactivate this number for ₹49"
                      : "This number is not available to rebuy"
                  }
                  className="inline-flex min-h-10 items-center justify-center gap-2 border border-[#174c3e] px-4 text-sm font-semibold text-[#174c3e] hover:bg-[#edf5f0] disabled:cursor-not-allowed disabled:border-[#cbd7d1] disabled:text-[#87928c] disabled:hover:bg-transparent"
                >
                  {busyPhone === number.phone ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  Rebuy · ₹49
                </button>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
