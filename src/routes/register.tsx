import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { registerUser } from "@/lib/register.functions";

export const Route = createFileRoute("/register")({
  beforeLoad: () => {
    throw redirect({ to: "/login", search: { redirect: "/numbers" } });
  },
  head: () => ({
    meta: [
      { title: "Register karein — Register Checker" },
      { name: "description", content: "Naam, email aur phone daal ke register karein." },
      { property: "og:title", content: "Register karein" },
      { property: "og:description", content: "Register karke Telegram bot se check karein." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setStatus("loading");
    setError("");
    const res = await registerUser({
      data: { name: String(f.get("name")), email: String(f.get("email")), phone: String(f.get("phone")) },
    });
    if (res.ok) setStatus("done");
    else {
      setError(res.error);
      setStatus("idle");
    }
  }

  const input = "mt-1 w-full rounded-lg border bg-card px-4 py-3 outline-none focus:ring-2 focus:ring-ring";

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 py-14">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Wapas</Link>
      <h1 className="mt-6 text-3xl font-bold">Register karein</h1>
      {status === "done" ? (
        <div className="mt-8 rounded-xl border bg-card p-6">
          <p className="text-lg font-bold text-success">✅ Aap registered ho gaye!</p>
          <p className="mt-2 text-muted-foreground">Ab Telegram bot pe apna email ya phone bhej ke check kar sakte hain.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label className="block text-sm font-medium">Naam
            <input name="name" required maxLength={100} className={input} />
          </label>
          <label className="block text-sm font-medium">Email
            <input name="email" type="email" required maxLength={255} className={input} />
          </label>
          <label className="block text-sm font-medium">Phone
            <input name="phone" type="tel" required maxLength={20} placeholder="9876543210" className={input} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            disabled={status === "loading"}
            className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {status === "loading" ? "Ho raha hai..." : "Register"}
          </button>
        </form>
      )}
    </main>
  );
}
