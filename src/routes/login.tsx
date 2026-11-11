import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { getLocalAuthSession, signInLocal, signUpLocal } from "@/lib/auth.functions";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect:
      search["redirect"] === "/checker"
        ? ("/checker" as const)
        : search["redirect"] === "/numbers/recent"
          ? ("/numbers/recent" as const)
          : search["redirect"] === "/api-docs"
            ? ("/api-docs" as const)
            : ("/numbers" as const),
  }),
  head: () => ({
    meta: [
      { title: "Sign in | WhatsApp Numbers" },
      { name: "description", content: "Sign in to your WhatsApp Numbers account." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    getLocalAuthSession().then((session) => {
      if (mounted && session) void navigate({ to: redirect });
    });
    return () => {
      mounted = false;
    };
  }, [navigate, redirect]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      if (mode === "login") {
        const result = await signInLocal({ data: { email, password } });
        if (!result.ok) throw new Error(result.error);
        await navigate({ to: redirect });
      } else {
        const result = await signUpLocal({ data: { email, password } });
        if (!result.ok) throw new Error(result.error);
        await navigate({ to: redirect });
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Unable to continue. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";

  return (
    <main className="min-h-screen bg-[#f4f6f3] text-[#202a27]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-8 place-items-center rounded-md bg-[#174c3e] text-sm font-bold text-white">
            W
          </span>
          WhatsApp Numbers
        </Link>
        <Link to="/" className="text-sm text-[#53625d] transition hover:text-[#202a27]">
          Back to home
        </Link>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-72px)] max-w-6xl items-center gap-12 px-5 py-10 sm:px-8 lg:grid-cols-[1fr_400px] lg:gap-24">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-[#26745b]">Account access</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
            Your work, in one place.
          </h1>
          <p className="mt-4 max-w-md text-base leading-7 text-[#596762]">
            Sign in to manage number checks and access your workspace.
          </p>
        </div>

        <div className="w-full border-t border-[#d5ddd7] pt-7 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <h2 className="text-2xl font-semibold">
            {mode === "login" ? "Sign in" : "Create an account"}
          </h2>
          <p className="mt-1 text-sm text-[#65716c]">
            {mode === "login"
              ? "Use your account email and password."
              : "Start with your email address."}
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-5">
            <label className="block text-sm font-medium" htmlFor="email">
              Email address
              <span className="relative block">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7b8781]" />
                <input
                  id="email"
                  autoComplete="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className={`${inputClass} pl-10`}
                />
              </span>
            </label>

            <label className="block text-sm font-medium" htmlFor="password">
              Password
              <span className="relative block">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7b8781]" />
                <input
                  id="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={10}
                  required
                  className={`${inputClass} pl-10 pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded text-[#65716c] hover:bg-[#edf1ed]"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#174c3e] px-4 text-sm font-medium text-white transition hover:bg-[#123e33] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
              {!busy && <ArrowRight className="size-4" />}
            </button>
          </form>

          <p className="mt-6 text-sm text-[#65716c]">
            {mode === "login" ? "New here?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode((value) => (value === "login" ? "signup" : "login"));
                setError("");
              }}
              className="font-medium text-[#26745b] hover:underline"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
