import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { trackEvent } from "../models/experiments.server";

const TrackEventSchema = z.object({
  experimentId: z.string().min(1),
  visitorId: z.string().min(1),
  variantKey: z.enum(["A", "B"]),
  eventType: z.enum(["IMPRESSION", "CLICK", "ADD_TO_CART", "CHECKOUT_STARTED", "PURCHASE"]),
  pagePath: z.string().optional(),
  eventValue: z.number().optional(),
  currency: z.string().optional(),
  cartToken: z.string().optional(),
  checkoutToken: z.string().optional(),
  orderId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const parsed = TrackEventSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  await trackEvent({
    ...parsed.data,
    metadata: parsed.data.metadata ?? {},
  });

  return json({ ok: true });
}
