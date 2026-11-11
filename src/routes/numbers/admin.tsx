import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Edit3,
  Eye,
  EyeOff,
  Globe2,
  Infinity as InfinityIcon,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LockKeyhole,
  Menu,
  Package,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  ToggleLeft,
  ToggleRight,
  UserCheck,
  UserX,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  formatINR,
  type AdminNumberStore,
  type AdminUserItem,
  type NumberOffer,
  type NumberStoreSettings,
} from "@/lib/numbers";
import {
  checkAdminAccess,
  lockAdminSession,
  unlockAdminWithKey,
} from "@/lib/admin-auth.functions";

export const Route = createFileRoute("/numbers/admin")({
  head: () => ({ meta: [{ title: "Admin | Fury Business Lines" }] }),
  component: NumberAdmin,
});

function NumberAdmin() {
  const [adminKey, setAdminKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [data, setData] = useState<AdminNumberStore | null>(null);
  const [offers, setOffers] = useState<NumberOffer[]>([]);
  const [settings, setSettings] = useState<NumberStoreSettings>({
    maintenance: false,
    domain: "fury.in",
  });
  const [paymentSettings, setPaymentSettings] = useState({
    enabled: false,
    environmentDisabled: false,
    merchantId: "",
    upiId: "",
    merchantName: "",
    hasAccessToken: false,
    hasSessionCookie: false,
  });
  const [accessTokenDraft, setAccessTokenDraft] = useState("");
  const [sessionCookieDraft, setSessionCookieDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // User Management State
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "active" | "banned">("all");
  const [passwordModalUser, setPasswordModalUser] = useState<AdminUserItem | null>(null);
  const [newPasswordDraft, setNewPasswordDraft] = useState("");
  const [showPasswordDraft, setShowPasswordDraft] = useState(false);

  const [balanceModalUser, setBalanceModalUser] = useState<AdminUserItem | null>(null);
  const [balanceDraft, setBalanceDraft] = useState<number>(0);
  const [balanceReasonDraft, setBalanceReasonDraft] = useState("");
  const [syncApiKeyDraft, setSyncApiKeyDraft] = useState(true);
  const [unlimitedDraft, setUnlimitedDraft] = useState(false);

  const [banModalUser, setBanModalUser] = useState<AdminUserItem | null>(null);
  const [banReasonDraft, setBanReasonDraft] = useState("Violation of terms / Suspicious activity");

  const [profileModalUser, setProfileModalUser] = useState<AdminUserItem | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [profilePhoneDraft, setProfilePhoneDraft] = useState("");
  const [userNotice, setUserNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    checkAdminAccess().then(async ({ isAdmin }) => {
      if (!mounted || !isAdmin) return;
      try {
        await loadAdmin("");
      } catch {
        // key might need to be explicitly entered
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function loadAdmin(key: string) {
    const headers: Record<string, string> = {};
    if (key) headers["x-admin-key"] = key;
    const response = await fetch("/api/business-lines/admin", { headers });
    const result = (await response.json().catch(() => null)) as
      AdminNumberStore | { error?: string } | null;
    if (!response.ok)
      throw new Error(
        response.status === 401 ? "Admin key was not accepted." : "Could not load admin data.",
      );
    const next = result as AdminNumberStore;
    setData(next);
    setOffers(next.offers);
    setSettings(next.settings);
    setPaymentSettings(next.paymentSettings);
    setAccessTokenDraft("");
    setSessionCookieDraft("");
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const unlockRes = await unlockAdminWithKey({ data: { adminKey: keyDraft } });
      if (!unlockRes.ok) {
        throw new Error(unlockRes.error || "Admin key was not accepted.");
      }
      await loadAdmin(keyDraft);
      setAdminKey(keyDraft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not connect to admin.");
    } finally {
      setBusy(false);
    }
  }

  async function saveChanges() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business-lines/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({
          offers,
          ...settings,
          payment: {
            ...paymentSettings,
            accessToken: accessTokenDraft || undefined,
            sessionCookie: sessionCookieDraft || undefined,
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not save changes.");
      await loadAdmin(adminKey);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function fulfillOrder(orderId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business-lines/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ fulfillOrderId: orderId }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not fulfill this order.");
      await loadAdmin(adminKey);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not fulfill this order.");
    } finally {
      setBusy(false);
    }
  }

  async function markPaymentRefunded(paymentId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business-lines/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ markPaymentRefundedId: paymentId }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not update the payment record.");
      await loadAdmin(adminKey);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the payment record.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEditPassword(e: FormEvent) {
    e.preventDefault();
    if (!passwordModalUser || newPasswordDraft.length < 6) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business-lines/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({
          editUserPassword: {
            userId: passwordModalUser.id,
            newPassword: newPasswordDraft,
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Failed to update password.");
      await loadAdmin(adminKey);
      const email = passwordModalUser.email;
      setPasswordModalUser(null);
      setNewPasswordDraft("");
      setUserNotice(`Password updated successfully for ${email}!`);
      setTimeout(() => setUserNotice(null), 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEditBalance(e: FormEvent) {
    e.preventDefault();
    if (!balanceModalUser) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business-lines/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({
          editUserBalance: {
            userId: balanceModalUser.id,
            balance: Number(balanceDraft),
            unlimited: unlimitedDraft,
            reason: balanceReasonDraft.trim() || undefined,
            syncApiKey: syncApiKeyDraft,
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Failed to update balance.");
      await loadAdmin(adminKey);
      const email = balanceModalUser.email;
      setBalanceModalUser(null);
      setUserNotice(
        unlimitedDraft
          ? `Balance set to Unlimited (∞) for ${email}!`
          : `Balance updated to ₹${Number(balanceDraft).toFixed(2)} for ${email}!`
      );
      setTimeout(() => setUserNotice(null), 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update balance.");
    } finally {
      setBusy(false);
    }
  }

  async function submitBanUser(e: FormEvent) {
    e.preventDefault();
    if (!banModalUser) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business-lines/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({
          banUser: {
            userId: banModalUser.id,
            banReason: banReasonDraft.trim() || undefined,
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Failed to ban user.");
      await loadAdmin(adminKey);
      const email = banModalUser.email;
      setBanModalUser(null);
      setUserNotice(`User ${email} has been banned.`);
      setTimeout(() => setUserNotice(null), 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ban user.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnbanUser(user: AdminUserItem) {
    if (!confirm(`Are you sure you want to unban ${user.email}? This will restore their account access.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business-lines/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({
          unbanUser: { userId: user.id },
        }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Failed to unban user.");
      await loadAdmin(adminKey);
      setUserNotice(`User ${user.email} has been unbanned.`);
      setTimeout(() => setUserNotice(null), 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unban user.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEditProfile(e: FormEvent) {
    e.preventDefault();
    if (!profileModalUser) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business-lines/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({
          editUserProfile: {
            userId: profileModalUser.id,
            name: profileNameDraft.trim() || undefined,
            phone: profilePhoneDraft.trim() || undefined,
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Failed to update profile.");
      await loadAdmin(adminKey);
      const email = profileModalUser.email;
      setProfileModalUser(null);
      setUserNotice(`Profile updated for ${email}!`);
      setTimeout(() => setUserNotice(null), 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f6f5] px-5 text-[#172821]">
        <form
          onSubmit={connect}
          className="w-full max-w-sm rounded-xl border border-[#dfe5e1] bg-white p-6"
        >
          <div className="grid size-10 place-items-center rounded-lg bg-[#edf4ef] text-[#315f49]">
            <LockKeyhole className="size-5" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold">Admin sign in</h1>
          <p className="mt-2 text-sm leading-6 text-[#64766f]">
            Enter the server configured business line admin key.
          </p>
          <input
            required
            type="password"
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            autoComplete="current-password"
            className="mt-5 w-full rounded-lg border border-[#cbd7d1] px-3 py-2.5 outline-none focus:border-[#477c68]"
            aria-label="Admin key"
          />
          {error ? (
            <p role="alert" className="mt-3 text-sm text-[#a5463c]">
              {error}
            </p>
          ) : null}
          <button
            disabled={busy}
            className="mt-4 w-full rounded-lg bg-[#15392f] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Connecting…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  function changeOffer(id: string, key: "monthlyPrice" | "available", value: number) {
    setOffers((rows) =>
      rows.map((row) =>
        row.id === id ? { ...row, [key]: Math.max(0, Math.floor(value || 0)) } : row,
      ),
    );
    setSaved(false);
  }

  const filteredUsers = (data?.users || []).filter((user) => {
    const term = userSearch.toLowerCase().trim();
    const matchSearch =
      !term ||
      user.email.toLowerCase().includes(term) ||
      user.name.toLowerCase().includes(term) ||
      user.phone.toLowerCase().includes(term);

    if (!matchSearch) return false;
    if (userFilter === "active") return !user.banned;
    if (userFilter === "banned") return user.banned;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#f4f6f5] text-[#172821]">
      <header className="flex h-16 items-center justify-between border-b border-[#dfe5e1] bg-white px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Toggle navigation"
            className="rounded-md p-2 hover:bg-[#f0f4f1] lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <a href="/numbers" className="flex items-center gap-2 font-bold">
            <span className="grid size-7 place-items-center rounded-md bg-[#15392f] text-xs text-white">
              F
            </span>{" "}
            Fury <span className="font-normal text-[#64766f]">/ Admin</span>
          </a>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/checker"
            className="hidden text-xs font-semibold text-[#52665f] hover:text-[#172821] sm:inline"
          >
            Checker Dashboard
          </Link>
          <Link
            to="/link"
            className="hidden text-xs font-semibold text-[#52665f] hover:text-[#172821] sm:inline"
          >
            WA Linker
          </Link>
          <Link
            to="/numbers"
            className="hidden text-xs font-semibold text-[#52665f] hover:text-[#172821] sm:inline"
          >
            Marketplace
          </Link>
          <span className="hidden text-sm text-[#64766f] sm:inline">
            {saved ? "Changes saved" : "Connected"}
          </span>
          {saved ? (
            <Check className="size-4 text-[#47805f]" />
          ) : (
            <span className="size-2 rounded-full bg-[#72a66c]" />
          )}
          <button
            onClick={async () => {
              await lockAdminSession();
              setData(null);
              setAdminKey("");
              setKeyDraft("");
            }}
            className="text-sm font-medium text-[#52665f] hover:text-[#172821]"
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1500px]">
        <aside
          className={`${settingsOpen ? "block" : "hidden"} fixed inset-y-16 left-0 z-20 w-60 border-r border-[#dfe5e1] bg-white p-4 lg:static lg:block lg:h-[calc(100vh-4rem)]`}
        >
          <p className="px-3 pb-2 pt-3 text-xs font-semibold uppercase text-[#819088]">Workspace</p>
          <a
            href="#overview"
            className="flex items-center gap-3 rounded-lg bg-[#edf4ef] px-3 py-2.5 text-sm font-semibold text-[#315f49]"
          >
            <LayoutDashboard className="size-4" /> Overview
          </a>
          <a
            href="#users"
            className="mt-1 flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-[#52665f] hover:bg-[#f4f7f5]"
          >
            <span className="flex items-center gap-3">
              <Users className="size-4" /> Users
            </span>
            <span className="rounded-full bg-[#15392f] px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
              {data.totals.totalUsers}
            </span>
          </a>
          <a
            href="#inventory"
            className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#52665f] hover:bg-[#f4f7f5]"
          >
            <Package className="size-4" /> Inventory
          </a>
          <a
            href="#orders"
            className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#52665f] hover:bg-[#f4f7f5]"
          >
            <ShoppingBag className="size-4" /> Orders
          </a>
          <p className="px-3 pb-2 pt-7 text-xs font-semibold uppercase text-[#819088]">Manage</p>
          <a
            href="#settings"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#52665f] hover:bg-[#f4f7f5]"
          >
            <Settings2 className="size-4" /> Store settings
          </a>
          <a
            href="#payments"
            className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#52665f] hover:bg-[#f4f7f5]"
          >
            <ShieldCheck className="size-4" /> Payments
          </a>
          <a
            href="#support"
            className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#52665f] hover:bg-[#f4f7f5]"
          >
            <LifeBuoy className="size-4" /> Help & support
          </a>
          <div className="absolute bottom-5 left-4 right-4 rounded-lg bg-[#f3f7f4] p-3 text-xs leading-5 text-[#64766f]">
            <CircleHelp className="mb-1 size-4" /> Store data is saved in the connected database.
          </div>
        </aside>
        <main id="overview" className="min-w-0 flex-1 px-4 py-7 sm:px-7 lg:px-10">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-[#718078]">Business line operations</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight">Marketplace overview</h1>
                <p className="mt-2 text-sm text-[#64766f]">
                  Inventory, monthly revenue, and customer orders.
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href="/numbers"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-[#cbd7d1] bg-white px-3.5 py-2.5 text-sm font-semibold hover:bg-[#f8faf9]"
                >
                  View marketplace <ChevronRight className="ml-1 inline size-4" />
                </a>
                <button
                  onClick={saveChanges}
                  disabled={busy}
                  className="rounded-lg bg-[#15392f] px-3.5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <Save className="mr-1.5 inline size-4" /> Save changes
                </button>
              </div>
            </div>
            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-[#f0d0cc] bg-[#fff5f3] px-4 py-3 text-sm text-[#a5463c]"
              >
                {error}
              </p>
            ) : null}
            <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                {
                  label: "Registered users",
                  value: String(data.totals.totalUsers),
                  change: `${data.totals.bannedUsers} banned account${data.totals.bannedUsers === 1 ? "" : "s"}`,
                  icon: Users,
                },
                {
                  label: "Total user balances",
                  value: formatINR(data.totals.totalUserBalance),
                  change: "Active customer wallet deposits",
                  icon: Wallet,
                },
                {
                  label: "Gross monthly sales",
                  value: formatINR(data.totals.grossMonthly),
                  change: `${data.totals.fulfilledOrders} fulfilled`,
                  icon: BarChart3,
                },
                {
                  label: "Fulfilled orders",
                  value: String(data.totals.fulfilledOrders),
                  change: "Business lines assigned",
                  icon: ShoppingBag,
                },
                {
                  label: "Stock remaining",
                  value: data.totals.stock.toLocaleString("en-IN"),
                  change: `${offers.length} regions`,
                  icon: Package,
                },
                {
                  label: "Pending orders",
                  value: String(data.totals.pendingOrders),
                  change: "Awaiting manual confirmation",
                  icon: Activity,
                },
              ].map((metric) => (
                <div key={metric.label} className="rounded-xl border border-[#dfe5e1] bg-white p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#64766f]">{metric.label}</span>
                    <metric.icon className="size-4 text-[#718078]" />
                  </div>
                  <p className="mt-4 text-2xl font-semibold tabular-nums">{metric.value}</p>
                  <p className="mt-1 text-xs text-[#64766f]">
                    <ArrowUpRight className="mr-0.5 inline size-3.5 text-[#477c68]" />
                    {metric.change}
                  </p>
                </div>
              ))}
            </section>

            {/* User Accounts & Balances Section */}
            <section id="users" className="mt-8 rounded-xl border border-[#dfe5e1] bg-white">
              <div className="flex flex-col gap-4 border-b border-[#e7ece9] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="size-5 text-[#265b4b]" />
                    <h2 className="text-lg font-semibold text-[#172821]">User Accounts & Balances</h2>
                  </div>
                  <p className="mt-1 text-xs text-[#718078]">
                    View registered users, edit passwords, update wallet balances, and ban/unban accounts.
                  </p>
                </div>

                {/* Search & Filter Bar */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[#819088]" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search email, name, phone..."
                      className="h-9 w-56 rounded-lg border border-[#cbd7d1] bg-white pl-9 pr-8 text-xs outline-none focus:border-[#477c68]"
                    />
                    {userSearch && (
                      <button
                        type="button"
                        onClick={() => setUserSearch("")}
                        className="absolute right-2.5 top-2.5 text-[#819088] hover:text-[#172821]"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="inline-flex rounded-lg border border-[#cbd7d1] bg-[#f8faf9] p-0.5 text-xs">
                    {(["all", "active", "banned"] as const).map((filter) => {
                      const count =
                        filter === "all"
                          ? data.users.length
                          : filter === "active"
                            ? data.users.filter((u) => !u.banned).length
                            : data.users.filter((u) => u.banned).length;
                      return (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setUserFilter(filter)}
                          className={`rounded-md px-2.5 py-1 font-medium capitalize transition ${
                            userFilter === filter
                              ? "bg-white text-[#15392f] shadow-sm"
                              : "text-[#64766f] hover:text-[#172821]"
                          }`}
                        >
                          {filter} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Success Notice */}
              {userNotice && (
                <div className="flex items-center justify-between border-b border-emerald-500/20 bg-emerald-50 px-5 py-2.5 text-xs font-medium text-emerald-800">
                  <span className="flex items-center gap-2">
                    <Check className="size-4 text-emerald-600" />
                    {userNotice}
                  </span>
                  <button
                    type="button"
                    onClick={() => setUserNotice(null)}
                    className="text-emerald-700 hover:text-emerald-900"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

              {/* Users Table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="bg-[#f8faf9] text-xs uppercase text-[#718078]">
                    <tr>
                      <th className="px-5 py-3 font-medium">User / Email</th>
                      <th className="px-5 py-3 font-medium">Phone</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Wallet Balance</th>
                      <th className="px-5 py-3 font-medium">API Balance</th>
                      <th className="px-5 py-3 font-medium">Registered</th>
                      <th className="px-5 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="border-t border-[#edf0ee] hover:bg-[#fafbfa]">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#172821]">
                              {user.name !== "—" ? user.name : user.email.split("@")[0]}
                            </span>
                            {user.hasPassword ? (
                              <span className="rounded bg-[#edf4ef] px-1.5 py-0.5 text-[10px] font-medium text-[#265b4b]">
                                Account
                              </span>
                            ) : (
                              <span className="rounded bg-[#f4f6f5] px-1.5 py-0.5 text-[10px] font-medium text-[#718078]">
                                Telegram
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#64766f]">{user.email}</div>
                        </td>

                        <td className="px-5 py-3.5 font-mono text-xs text-[#42524a]">
                          {user.phone !== "—" ? user.phone : <span className="text-[#99a69f]">None</span>}
                        </td>

                        <td className="px-5 py-3.5">
                          {user.banned ? (
                            <span
                              title={user.banReason ? `Reason: ${user.banReason}` : "Account is banned"}
                              className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700"
                            >
                              <ShieldAlert className="size-3" />
                              Banned
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                              <Check className="size-3" />
                              Active
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            {user.unlimited ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                <InfinityIcon className="size-3.5" /> Unlimited
                              </span>
                            ) : (
                              <span className="font-mono font-semibold text-[#172821]">
                                ₹{user.walletBalance.toFixed(2)}
                              </span>
                            )}
                            <button
                              type="button"
                              title="Edit wallet balance"
                              onClick={() => {
                                setBalanceModalUser(user);
                                setBalanceDraft(user.walletBalance);
                                setUnlimitedDraft(Boolean(user.unlimited));
                                setBalanceReasonDraft("");
                                setSyncApiKeyDraft(true);
                              }}
                              className="rounded p-1 text-[#64766f] transition hover:bg-[#edf4ef] hover:text-[#172821]"
                            >
                              <Wallet className="size-3.5 text-[#265b4b]" />
                            </button>
                          </div>
                        </td>

                        <td className="px-5 py-3.5">
                          {user.unlimited ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                              <InfinityIcon className="size-3" /> Unlimited
                            </span>
                          ) : (
                            <span className="font-mono text-xs text-[#52665f]">
                              ₹{user.apiBalance.toFixed(2)}
                            </span>
                          )}
                          {user.apiKey && (
                            <span className="block font-mono text-[10px] text-[#819088]">
                              {user.apiKey.slice(0, 10)}...
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-xs text-[#718078]">
                          {new Date(user.createdAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>

                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Edit Balance */}
                            <button
                              type="button"
                              title="Adjust wallet balance"
                              onClick={() => {
                                setBalanceModalUser(user);
                                setBalanceDraft(user.walletBalance);
                                setUnlimitedDraft(Boolean(user.unlimited));
                                setBalanceReasonDraft("");
                                setSyncApiKeyDraft(true);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-[#cbd7d1] bg-white px-2 py-1 text-xs font-medium text-[#172821] transition hover:bg-[#edf4ef]"
                            >
                              <Wallet className="size-3 text-[#265b4b]" />
                              <span>Balance</span>
                            </button>

                            {/* Edit Password */}
                            <button
                              type="button"
                              title="Change user password"
                              onClick={() => {
                                setPasswordModalUser(user);
                                setNewPasswordDraft("");
                                setShowPasswordDraft(false);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-[#cbd7d1] bg-white px-2 py-1 text-xs font-medium text-[#172821] transition hover:bg-[#edf4ef]"
                            >
                              <KeyRound className="size-3 text-[#265b4b]" />
                              <span>Password</span>
                            </button>

                            {/* Edit Profile */}
                            <button
                              type="button"
                              title="Edit profile (name & phone)"
                              onClick={() => {
                                setProfileModalUser(user);
                                setProfileNameDraft(user.name !== "—" ? user.name : "");
                                setProfilePhoneDraft(user.phone !== "—" ? user.phone : "");
                              }}
                              className="rounded-md border border-[#cbd7d1] bg-white p-1 text-[#64766f] transition hover:bg-[#edf4ef] hover:text-[#172821]"
                            >
                              <Edit3 className="size-3.5" />
                            </button>

                            {/* Ban / Unban */}
                            {user.banned ? (
                              <button
                                type="button"
                                title="Unban this user"
                                disabled={busy}
                                onClick={() => void handleUnbanUser(user)}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                              >
                                <UserCheck className="size-3" />
                                <span>Unban</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Ban this user"
                                onClick={() => {
                                  setBanModalUser(user);
                                  setBanReasonDraft("Violation of terms / Suspicious activity");
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100"
                              >
                                <UserX className="size-3" />
                                <span>Ban</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredUsers.length === 0 && (
                  <div className="py-12 text-center text-sm text-[#718078]">
                    {userSearch ? "No users match your search query." : "No registered users found."}
                  </div>
                )}
              </div>
            </section>
            <section id="inventory" className="mt-8 rounded-xl border border-[#dfe5e1] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7ece9] px-4 py-4 sm:px-5">
                <div>
                  <h2 className="font-semibold">Regional inventory</h2>
                  <p className="mt-1 text-xs text-[#718078]">
                    Edit monthly price and stock, then save changes.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setOffers((rows) => [
                      ...rows,
                      {
                        id: `region-${Date.now()}`,
                        city: "New region",
                        label: "New business line",
                        prefix: "+91",
                        available: 0,
                        monthlyPrice: 899,
                      },
                    ]);
                    setSaved(false);
                  }}
                  className="rounded-lg bg-[#15392f] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#265b4b]"
                >
                  Add region
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-[#f8faf9] text-xs uppercase text-[#718078]">
                    <tr>
                      <th className="px-5 py-3 font-medium">Region</th>
                      <th className="px-5 py-3 font-medium">Prefix</th>
                      <th className="px-5 py-3 font-medium">Available</th>
                      <th className="px-5 py-3 font-medium">Monthly price</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((offer) => (
                      <tr key={offer.id} className="border-t border-[#edf0ee]">
                        <td className="px-5 py-3.5 font-medium">
                          <input
                            aria-label={`${offer.city} city`}
                            value={offer.city}
                            onChange={(event) =>
                              setOffers((rows) =>
                                rows.map((row) =>
                                  row.id === offer.id ? { ...row, city: event.target.value } : row,
                                ),
                              )
                            }
                            className="w-36 rounded border border-transparent px-1 py-1 focus:border-[#cbd7d1]"
                          />
                          <input
                            aria-label={`${offer.city} plan label`}
                            value={offer.label}
                            onChange={(event) =>
                              setOffers((rows) =>
                                rows.map((row) =>
                                  row.id === offer.id ? { ...row, label: event.target.value } : row,
                                ),
                              )
                            }
                            className="block w-44 rounded border border-transparent px-1 py-1 text-xs font-normal text-[#718078] focus:border-[#cbd7d1]"
                          />
                        </td>
                        <td className="px-5 py-3.5">
                          <input
                            aria-label={`${offer.city} prefix`}
                            value={offer.prefix}
                            onChange={(event) =>
                              setOffers((rows) =>
                                rows.map((row) =>
                                  row.id === offer.id
                                    ? { ...row, prefix: event.target.value }
                                    : row,
                                ),
                              )
                            }
                            className="w-24 rounded border border-transparent px-1 py-1 tabular-nums focus:border-[#cbd7d1]"
                          />
                        </td>
                        <td className="px-5 py-3.5">
                          <input
                            aria-label={`${offer.city} stock`}
                            type="number"
                            min="0"
                            value={offer.available}
                            onChange={(event) =>
                              changeOffer(offer.id, "available", Number(event.target.value))
                            }
                            className="w-20 rounded-md border border-[#cbd7d1] px-2 py-1.5 tabular-nums outline-none focus:border-[#477c68]"
                          />
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex w-32 items-center gap-1 rounded-md border border-[#cbd7d1] px-2">
                            <span className="text-[#718078]">₹</span>
                            <input
                              aria-label={`${offer.city} price`}
                              type="number"
                              min="0"
                              step="50"
                              value={offer.monthlyPrice}
                              onChange={(event) =>
                                changeOffer(offer.id, "monthlyPrice", Number(event.target.value))
                              }
                              className="w-full py-1.5 tabular-nums outline-none"
                            />
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${offer.available > 0 ? "bg-[#eaf4eb] text-[#386849]" : "bg-[#fceceb] text-[#a5463c]"}`}
                          >
                            {offer.available > 0 ? "Available" : "Out of stock"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <button
                            onClick={() =>
                              setOffers((rows) => rows.filter((row) => row.id !== offer.id))
                            }
                            aria-label={`Remove ${offer.city}`}
                            className="rounded-md p-1.5 text-[#819088] hover:bg-[#fceceb] hover:text-[#a5463c]"
                          >
                            <X className="size-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2 border-t border-[#e7ece9] px-5 py-3 text-xs text-[#718078]">
                <Check className="size-4 text-[#477c68]" /> Changes apply to the public catalog
                after saving.
              </div>
            </section>
            <section id="orders" className="mt-5 rounded-xl border border-[#dfe5e1] bg-white">
              <div className="border-b border-[#e7ece9] px-5 py-4">
                <h2 className="font-semibold">Customer orders</h2>
                <p className="mt-1 text-xs text-[#718078]">
                  Fulfill only after the business line has been assigned.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[750px] text-left text-sm">
                  <thead className="bg-[#f8faf9] text-xs uppercase text-[#718078]">
                    <tr>
                      <th className="px-5 py-3 font-medium">Order</th>
                      <th className="px-5 py-3 font-medium">Customer</th>
                      <th className="px-5 py-3 font-medium">Region</th>
                      <th className="px-5 py-3 font-medium">Monthly total</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map((order) => (
                      <tr key={order.id} className="border-t border-[#edf0ee]">
                        <td className="px-5 py-3.5 font-medium">
                          {order.id}
                          <span className="block pt-0.5 text-xs font-normal text-[#718078]">
                            {new Date(order.createdAt).toLocaleString()}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          {order.customer}
                          <span className="block pt-0.5 text-xs font-normal text-[#718078]">
                            {order.email}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          {order.city}
                          <span className="block pt-0.5 text-xs text-[#718078]">
                            {order.quantity} line{order.quantity === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 font-medium tabular-nums">
                          {formatINR(order.monthlyTotal)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${order.status === "fulfilled" ? "bg-[#eaf4eb] text-[#386849]" : "bg-[#fff2e6] text-[#9c5725]"}`}
                          >
                            {order.status === "fulfilled" ? "Fulfilled" : "Requested"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          {order.status === "requested" ? (
                            <button
                              disabled={busy}
                              onClick={() => void fulfillOrder(order.id)}
                              className="rounded-md border border-[#cbd7d1] px-2.5 py-1.5 text-xs font-semibold hover:bg-[#f8faf9] disabled:opacity-50"
                            >
                              Mark fulfilled
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.orders.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-[#718078]">
                    No customer orders yet.
                  </p>
                ) : null}
              </div>
            </section>
            <section id="settings" className="mt-5 rounded-xl border border-[#dfe5e1] bg-white">
              <div className="border-b border-[#e7ece9] px-5 py-4">
                <h2 className="font-semibold">Store settings</h2>
                <p className="mt-1 text-xs text-[#718078]">
                  Control public catalog availability and its displayed brand domain.
                </p>
              </div>
              <div className="grid gap-0 md:grid-cols-2">
                <div className="border-b border-[#edf0ee] p-5 md:border-b-0 md:border-r">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#f0f4f1]">
                      <Globe2 className="size-4 text-[#477c68]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold">Store domain label</h3>
                      <p className="mt-1 text-xs leading-5 text-[#718078]">
                        This changes the brand label only; DNS is managed separately.
                      </p>
                      <input
                        aria-label="Storefront domain"
                        value={settings.domain}
                        onChange={(event) => {
                          setSettings((current) => ({ ...current, domain: event.target.value }));
                          setSaved(false);
                        }}
                        className="mt-3 w-full rounded-lg border border-[#cbd7d1] px-3 py-2 text-sm outline-none focus:border-[#477c68]"
                      />
                    </div>
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#fff2e6]">
                      <Activity className="size-4 text-[#ad672c]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold">Maintenance mode</h3>
                        <button
                          role="switch"
                          aria-checked={settings.maintenance}
                          aria-label="Toggle maintenance mode"
                          onClick={() => {
                            setSettings((current) => ({
                              ...current,
                              maintenance: !current.maintenance,
                            }));
                            setSaved(false);
                          }}
                          className={`rounded-full transition ${settings.maintenance ? "text-[#477c68]" : "text-[#9aa8a0]"}`}
                        >
                          {settings.maintenance ? (
                            <ToggleRight className="size-7" />
                          ) : (
                            <ToggleLeft className="size-7" />
                          )}
                        </button>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[#718078]">
                        Visitors see a service notice while the catalog is paused.
                      </p>
                      <span
                        className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${settings.maintenance ? "bg-[#fff0e5] text-[#9c5725]" : "bg-[#eaf4eb] text-[#386849]"}`}
                      >
                        {settings.maintenance ? "Store is paused" : "Store is live"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <section className="mt-5 border-y border-[#dfe5e1] bg-white">
              <div className="border-b border-[#e7ece9] px-5 py-4">
                <h2 className="font-semibold">Payment activity</h2>
                <p className="mt-1 text-xs text-[#718078]">
                  UPI refunds are handled manually. Mark a refund complete after it has been sent.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[#f8faf9] text-xs uppercase text-[#718078]">
                    <tr>
                      <th className="px-5 py-3 font-medium">Payment</th>
                      <th className="px-5 py-3 font-medium">Number</th>
                      <th className="px-5 py-3 font-medium">Customer</th>
                      <th className="px-5 py-3 font-medium">Amount</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((payment) => (
                      <tr key={payment.id} className="border-t border-[#edf0ee]">
                        <td className="px-5 py-3.5 font-mono text-xs">
                          {payment.utr}
                          <span className="block pt-1 font-sans text-[#718078]">
                            {new Date(payment.createdAt).toLocaleString()}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs">{payment.phone}</td>
                        <td className="px-5 py-3.5 font-mono text-xs">{payment.userId}</td>
                        <td className="px-5 py-3.5 font-medium tabular-nums">
                          {formatINR(payment.amount)}
                        </td>
                        <td className="px-5 py-3.5 capitalize">
                          {payment.status.replaceAll("_", " ")}
                        </td>
                        <td className="px-5 py-3.5">
                          {payment.status === "refund_required" ? (
                            <button
                              disabled={busy}
                              onClick={() => void markPaymentRefunded(payment.id)}
                              className="rounded-md border border-[#cbd7d1] px-2.5 py-1.5 text-xs font-semibold hover:bg-[#f8faf9] disabled:opacity-50"
                            >
                              Mark refunded
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.payments.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-[#718078]">No payments yet.</p>
                ) : null}
              </div>
            </section>
            <section id="payments" className="mt-5 border-y border-[#dfe5e1] bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e7ece9] px-5 py-4">
                <div>
                  <h2 className="font-semibold">BharatPe UPI payments</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-[#718078]">
                    Customers pay ₹49 by UPI and submit a UTR. The server verifies the exact amount
                    and successful status before activating a number.
                  </p>
                  {paymentSettings.environmentDisabled ? (
                    <p className="mt-2 text-xs font-medium text-[#a5463c]">
                      Disabled by PAYMENT_SYSTEM_ENABLED in the server environment.
                    </p>
                  ) : null}
                </div>
                <button
                  role="switch"
                  aria-checked={paymentSettings.enabled}
                  aria-label="Enable BharatPe payments"
                  onClick={() => {
                    setPaymentSettings((current) => ({ ...current, enabled: !current.enabled }));
                    setSaved(false);
                  }}
                  className={`rounded-full transition ${paymentSettings.enabled ? "text-[#477c68]" : "text-[#9aa8a0]"}`}
                >
                  {paymentSettings.enabled ? (
                    <ToggleRight className="size-7" />
                  ) : (
                    <ToggleLeft className="size-7" />
                  )}
                </button>
              </div>
              <div className="grid gap-0 md:grid-cols-2">
                <label className="border-b border-[#edf0ee] p-5 text-sm md:border-r">
                  Merchant ID
                  <input
                    autoComplete="off"
                    value={paymentSettings.merchantId}
                    onChange={(event) => {
                      setPaymentSettings((current) => ({
                        ...current,
                        merchantId: event.target.value,
                      }));
                      setSaved(false);
                    }}
                    className="mt-2 w-full rounded-md border border-[#cbd7d1] px-3 py-2 text-sm outline-none focus:border-[#477c68]"
                  />
                </label>
                <label className="border-b border-[#edf0ee] p-5 text-sm">
                  UPI ID
                  <input
                    autoComplete="off"
                    placeholder="merchant@upi"
                    value={paymentSettings.upiId}
                    onChange={(event) => {
                      setPaymentSettings((current) => ({ ...current, upiId: event.target.value }));
                      setSaved(false);
                    }}
                    className="mt-2 w-full rounded-md border border-[#cbd7d1] px-3 py-2 text-sm outline-none focus:border-[#477c68]"
                  />
                </label>
                <label className="border-b border-[#edf0ee] p-5 text-sm md:border-r">
                  Merchant name
                  <input
                    autoComplete="organization"
                    value={paymentSettings.merchantName}
                    onChange={(event) => {
                      setPaymentSettings((current) => ({
                        ...current,
                        merchantName: event.target.value,
                      }));
                      setSaved(false);
                    }}
                    className="mt-2 w-full rounded-md border border-[#cbd7d1] px-3 py-2 text-sm outline-none focus:border-[#477c68]"
                  />
                </label>
                <label className="border-b border-[#edf0ee] p-5 text-sm">
                  BharatPe access token
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      paymentSettings.hasAccessToken
                        ? "Saved securely; enter to replace"
                        : "Paste access token"
                    }
                    value={accessTokenDraft}
                    onChange={(event) => setAccessTokenDraft(event.target.value)}
                    className="mt-2 w-full rounded-md border border-[#cbd7d1] px-3 py-2 text-sm outline-none focus:border-[#477c68]"
                  />
                </label>
                <label className="p-5 text-sm md:border-r">
                  Session cookie (optional)
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      paymentSettings.hasSessionCookie
                        ? "Saved securely; enter to replace"
                        : "Paste session cookie if required"
                    }
                    value={sessionCookieDraft}
                    onChange={(event) => setSessionCookieDraft(event.target.value)}
                    className="mt-2 w-full rounded-md border border-[#cbd7d1] px-3 py-2 text-sm outline-none focus:border-[#477c68]"
                  />
                </label>
                <div className="p-5 text-xs leading-5 text-[#718078]">
                  <LockKeyhole className="mb-1 size-4 text-[#477c68]" />
                  Credentials are encrypted in MongoDB and never returned to the browser. Configure
                  PAYMENT_CONFIG_ENCRYPTION_KEY on the server before saving credentials.
                </div>
              </div>
            </section>
            <p
              id="support"
              className="mt-6 flex items-center justify-center gap-1 text-xs text-[#819088]"
            >
              Save changes to apply catalog and payment settings.
            </p>
          </div>
        </main>
      </div>

      {/* Edit Password Modal */}
      {passwordModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#cbd7d1] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#edf0ee]">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-[#edf4ef] text-[#265b4b]">
                  <KeyRound className="size-4" />
                </span>
                <div>
                  <h3 className="font-semibold text-[#172821]">Edit User Password</h3>
                  <p className="text-xs text-[#718078]">{passwordModalUser.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPasswordModalUser(null)}
                className="rounded p-1 text-[#819088] hover:bg-[#edf0ee] hover:text-[#172821]"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={submitEditPassword} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[#64766f]">
                  New Password
                </label>
                <div className="relative mt-1">
                  <input
                    required
                    type={showPasswordDraft ? "text" : "password"}
                    minLength={6}
                    value={newPasswordDraft}
                    onChange={(e) => setNewPasswordDraft(e.target.value)}
                    placeholder="Enter at least 6 characters"
                    className="w-full rounded-lg border border-[#cbd7d1] px-3.5 py-2.5 text-sm outline-none focus:border-[#265b4b]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordDraft((v) => !v)}
                    className="absolute right-3 top-3 text-[#819088] hover:text-[#172821]"
                  >
                    {showPasswordDraft ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[#718078]">
                  Setting a new password will immediately revoke all active sessions for this account.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#edf0ee]">
                <button
                  type="button"
                  onClick={() => setPasswordModalUser(null)}
                  className="rounded-lg border border-[#cbd7d1] px-4 py-2 text-xs font-medium text-[#52665f] hover:bg-[#f8faf9]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || newPasswordDraft.length < 6}
                  className="rounded-lg bg-[#15392f] px-4 py-2 text-xs font-semibold text-white hover:bg-[#265b4b] disabled:opacity-50"
                >
                  {busy ? "Saving..." : "Update Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Balance Modal */}
      {balanceModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#cbd7d1] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#edf0ee]">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-[#edf4ef] text-[#265b4b]">
                  <Wallet className="size-4" />
                </span>
                <div>
                  <h3 className="font-semibold text-[#172821]">Edit Wallet Balance</h3>
                  <p className="text-xs text-[#718078]">{balanceModalUser.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBalanceModalUser(null)}
                className="rounded p-1 text-[#819088] hover:bg-[#edf0ee] hover:text-[#172821]"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={submitEditBalance} className="mt-4 space-y-4">
              {/* Unlimited Balance Toggle Card */}
              <div
                className={`rounded-xl border p-3.5 transition-all ${
                  unlimitedDraft
                    ? "border-emerald-500/50 bg-emerald-50/70 ring-2 ring-emerald-500/20"
                    : "border-[#cbd7d1] bg-[#f8faf9]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`grid size-8 place-items-center rounded-lg ${
                        unlimitedDraft
                          ? "bg-emerald-600 text-white"
                          : "bg-[#dfe6e2] text-[#52665f]"
                      }`}
                    >
                      <InfinityIcon className="size-4" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-[#172821]">Unlimited Balance Mode</p>
                        {unlimitedDraft && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#64766f]">
                        {unlimitedDraft
                          ? "User bypasses all wallet & API checks. Numbers are free."
                          : "Standard balance deduction applies per number purchase."}
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={unlimitedDraft}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setUnlimitedDraft(checked);
                        if (checked && balanceDraft < 1000) {
                          setBalanceDraft(999999);
                        }
                      }}
                      className="peer sr-only"
                    />
                    <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none"></div>
                  </label>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold uppercase text-[#64766f]">
                    Wallet Balance (₹)
                  </label>
                  <span className="text-xs text-[#718078]">
                    Current: <strong>₹{balanceModalUser.walletBalance.toFixed(2)}</strong>
                    {balanceModalUser.unlimited && (
                      <span className="ml-1 text-emerald-600 font-bold">(∞ Unlimited)</span>
                    )}
                  </span>
                </div>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  max="10000000"
                  value={balanceDraft}
                  onChange={(e) => setBalanceDraft(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-[#cbd7d1] px-3.5 py-2.5 font-mono text-base font-bold outline-none focus:border-[#265b4b]"
                />
              </div>

              {/* Quick increment buttons */}
              <div>
                <p className="text-[11px] font-medium text-[#718078] mb-1.5">Quick adjustments:</p>
                <div className="flex flex-wrap gap-1.5">
                  {[50, 100, 200, 500].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setBalanceDraft((curr) => Number((curr + amt).toFixed(2)))}
                      className="rounded-md border border-[#cbd7d1] bg-[#f8faf9] px-2.5 py-1 text-xs font-medium hover:bg-[#edf4ef]"
                    >
                      +₹{amt}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBalanceDraft(0)}
                    className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                  >
                    Reset (₹0)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-[#64766f]">
                  Audit Reason / Note (optional)
                </label>
                <input
                  type="text"
                  value={balanceReasonDraft}
                  onChange={(e) => setBalanceReasonDraft(e.target.value)}
                  placeholder="e.g. Manual top-up via UPI / Testing credit"
                  className="mt-1 w-full rounded-lg border border-[#cbd7d1] px-3.5 py-2 text-xs outline-none focus:border-[#265b4b]"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-[#52665f] cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncApiKeyDraft}
                  onChange={(e) => setSyncApiKeyDraft(e.target.checked)}
                  className="rounded border-[#cbd7d1] text-[#265b4b] focus:ring-[#265b4b]"
                />
                <span>Also sync balance to active API key</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#edf0ee]">
                <button
                  type="button"
                  onClick={() => setBalanceModalUser(null)}
                  className="rounded-lg border border-[#cbd7d1] px-4 py-2 text-xs font-medium text-[#52665f] hover:bg-[#f8faf9]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-[#15392f] px-4 py-2 text-xs font-semibold text-white hover:bg-[#265b4b] disabled:opacity-50"
                >
                  {busy ? "Updating..." : "Update Balance"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ban User Modal */}
      {banModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-red-100">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-red-100 text-red-700">
                  <ShieldAlert className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-red-900">Ban User Account</h3>
                  <p className="text-xs text-[#718078]">{banModalUser.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBanModalUser(null)}
                className="rounded p-1 text-[#819088] hover:bg-[#edf0ee] hover:text-[#172821]"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={submitBanUser} className="mt-4 space-y-4">
              <div className="rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-800 border border-red-100">
                <strong>Warning:</strong> Banning this user will immediately log them out, terminate all active browser sessions, disable their API keys, and prevent any future sign-ins or number purchases.
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-[#64766f]">
                  Ban Reason (shown to user upon sign in)
                </label>
                <textarea
                  required
                  rows={2}
                  value={banReasonDraft}
                  onChange={(e) => setBanReasonDraft(e.target.value)}
                  placeholder="Enter reason for suspension..."
                  className="mt-1 w-full rounded-lg border border-[#cbd7d1] p-3 text-xs outline-none focus:border-red-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#edf0ee]">
                <button
                  type="button"
                  onClick={() => setBanModalUser(null)}
                  className="rounded-lg border border-[#cbd7d1] px-4 py-2 text-xs font-medium text-[#52665f] hover:bg-[#f8faf9]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? "Banning..." : "Confirm Ban"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {profileModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#cbd7d1] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#edf0ee]">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-[#edf4ef] text-[#265b4b]">
                  <Edit3 className="size-4" />
                </span>
                <div>
                  <h3 className="font-semibold text-[#172821]">Edit User Details</h3>
                  <p className="text-xs text-[#718078]">{profileModalUser.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalUser(null)}
                className="rounded p-1 text-[#819088] hover:bg-[#edf0ee] hover:text-[#172821]"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={submitEditProfile} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[#64766f]">
                  Full Name / Display Name
                </label>
                <input
                  type="text"
                  value={profileNameDraft}
                  onChange={(e) => setProfileNameDraft(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="mt-1 w-full rounded-lg border border-[#cbd7d1] px-3.5 py-2.5 text-sm outline-none focus:border-[#265b4b]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-[#64766f]">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={profilePhoneDraft}
                  onChange={(e) => setProfilePhoneDraft(e.target.value)}
                  placeholder="e.g. +91 9876543210"
                  className="mt-1 w-full rounded-lg border border-[#cbd7d1] px-3.5 py-2.5 font-mono text-sm outline-none focus:border-[#265b4b]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#edf0ee]">
                <button
                  type="button"
                  onClick={() => setProfileModalUser(null)}
                  className="rounded-lg border border-[#cbd7d1] px-4 py-2 text-xs font-medium text-[#52665f] hover:bg-[#f8faf9]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-[#15392f] px-4 py-2 text-xs font-semibold text-white hover:bg-[#265b4b] disabled:opacity-50"
                >
                  {busy ? "Saving..." : "Save Details"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
