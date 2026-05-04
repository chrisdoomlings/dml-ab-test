import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { trackEvent } from "../models/experiments.server";
import { corsHeaders, isAllowedStorefrontOrigin, optionsResponse } from "../lib/cors.server";
import { prisma } from "../lib/db.server";
import { isLikelyBot, isRateLimited, isReasonableBodySize } from "../lib/public-api-security.server";

const TrackEventSchema = z.object({
  shopDomain: z.string().min(3).max(255),
  experimentId: z.string().min(1),
  visitorId: z.string().min(1).max(128),
  variantKey: z.enum(["A", "B"]),
  eventType: z.enum(["IMPRESSION", "CLICK", "ADD_TO_CART", "CHECKOUT_STARTED"]),
  pagePath: z.string().max(2048).optional(),
  eventValue: z.number().finite().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  cartToken: z.string().max(255).optional(),
  checkoutToken: z.string().max(255).optional(),
  orderId: z.string().max(255).optional(),
  metadata: z.record(z.any()).optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return optionsResponse(request);

  const defaultHeaders = corsHeaders(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: defaultHeaders });
  }

  if (!request.headers.get("Origin")) {
    return json({ error: "Forbidden" }, { status: 403, headers: defaultHeaders });
  }

  if (!isReasonableBodySize(request)) {
    return json({ error: "Payload too large" }, { status: 413, headers: defaultHeaders });
  }

  if (isLikelyBot(request)) {
    return json({ ok: true, skipped: "Bot traffic" }, { headers: defaultHeaders });
  }

  const body = await request.json().catch(() => null);
  const parsed = TrackEventSchema.safeParse(body);
  const headers = corsHeaders(request, parsed.success ? parsed.data.shopDomain : undefined);

  if (!parsed.success) {
    return json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400, headers },
    );
  }

  if (!isAllowedStorefrontOrigin(request, parsed.data.shopDomain)) {
    return json({ error: "Origin not allowed" }, { status: 403, headers });
  }

  if (isRateLimited(request, [parsed.data.shopDomain, parsed.data.visitorId])) {
    return json({ error: "Too many requests" }, { status: 429, headers });
  }

  const experiment = await prisma.experiment.findFirst({
    where: {
      id: parsed.data.experimentId,
      shop: { shopDomain: parsed.data.shopDomain },
      status: "ACTIVE",
    },
    select: { verificationMode: true },
  });

  if (!experiment) {
    return json({ error: "Experiment not found" }, { status: 404, headers });
  }

  const assignment = await prisma.visitorAssignment.findUnique({
    where: {
      experimentId_visitorId: {
        experimentId: parsed.data.experimentId,
        visitorId: parsed.data.visitorId,
      },
    },
    select: { variantKey: true },
  });

  if (!assignment) {
    return json({ error: "Assignment not found" }, { status: 409, headers });
  }

  if (!experiment.verificationMode && assignment.variantKey !== parsed.data.variantKey) {
    return json({ error: "Variant does not match assignment" }, { status: 409, headers });
  }

  const { shopDomain: _shopDomain, ...event } = parsed.data;
  await trackEvent({
    ...event,
    metadata: event.metadata ?? {},
  });

  return json({ ok: true }, { headers });
}
