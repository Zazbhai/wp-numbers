import { createFileRoute } from "@tanstack/react-router";
import {
  createBusinessLineOrder,
  getPublicBusinessLines,
  orderRequestSchema,
} from "@/lib/business-lines.server";

export const Route = createFileRoute("/api/business-lines")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const data = await getPublicBusinessLines();
          return Response.json(data, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error("[business-lines GET]", error);
          return Response.json({ error: "Business line catalog is unavailable" }, { status: 503 });
        }
      },
      POST: async ({ request }) => {
        const parsed = orderRequestSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "Check your details and try again" }, { status: 400 });

        try {
          const result = await createBusinessLineOrder(parsed.data);
          if (!result.ok) {
            const message =
              result.reason === "maintenance"
                ? "The catalog is paused"
                : "That quantity is no longer available";
            return Response.json({ error: message }, { status: 409 });
          }
          return Response.json(result.order, { status: 201 });
        } catch (error) {
          console.error("[business-lines POST]", error);
          return Response.json({ error: "Could not submit your request" }, { status: 503 });
        }
      },
    },
  },
});
