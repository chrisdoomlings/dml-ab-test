import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
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

// Remix/Vercel may route OPTIONS to loader instead of action
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return optionsResponse(request);
  return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders(request) });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return optionsResponse(request);

  const defaultHeaders = corsHeaders(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: defaultHeaders });
  }

  if (!isReasonableBodySize(request)) {
    return json({ error: "Payload too large" }, { status: 413, headers: defaultHeaders });
  }

  if (isLikelyBot(request)) {
    return json({ ok: true, skipped: "Bot traffic" }, { headers: defaultHeaders });
  }

  // Use text() + manual parse so Content-Type (text/plain vs application/json) never throws
  let body: unknown = null;
  try {
    const raw = await request.text();
    body = JSON.parse(raw);
  } catch {
    // fall through — safeParse(null) will return a 400
  }

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

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: parsed.data.shopDomain },
      select: { id: true },
    });

    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404, headers });
    }

    const experiment = await prisma.experiment.findFirst({
      where: { id: parsed.data.experimentId, shopId: shop.id, status: "ACTIVE" },
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
    await trackEvent({ ...event, metadata: event.metadata ?? {} });

    return json({ ok: true }, { headers });
  } catch (err) {
    console.error("[track] unhandled error:", err);
    return json({ error: "Internal error" }, { status: 500, headers });
  }
}
