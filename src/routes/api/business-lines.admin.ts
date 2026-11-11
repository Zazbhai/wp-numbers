import { createFileRoute } from "@tanstack/react-router";
import {
  adminUpdateSchema,
  getAdminBusinessLines,
  isValidAdminKey,
  updateAdminBusinessLines,
} from "@/lib/business-lines.server";
import { isRequestAdmin } from "@/lib/admin-auth.server";

function authorized(request: Request) {
  return isValidAdminKey(request.headers.get("x-admin-key") ?? "") || isRequestAdmin(request);
}

export const Route = createFileRoute("/api/business-lines/admin")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        try {
          return Response.json(await getAdminBusinessLines(), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          console.error("[business-lines admin GET]", error);
          return Response.json({ error: "Could not load admin data" }, { status: 503 });
        }
      },
      PATCH: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        const parsed = adminUpdateSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "Invalid admin update" }, { status: 400 });
        try {
          const result = await updateAdminBusinessLines(parsed.data);
          if (!result.ok) {
            const status = result.reason === "stock-shortage" ? 409 : 400;
            return Response.json({ error: result.reason }, { status });
          }
          return Response.json({ ok: true });
        } catch (error) {
          console.error("[business-lines admin PATCH]", error);
          return Response.json({ error: "Could not save admin changes" }, { status: 503 });
        }
      },
    },
  },
});
