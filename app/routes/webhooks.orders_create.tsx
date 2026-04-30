import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../lib/db.server";

type ShopifyOrderWebhook = {
  id: number;
  total_price: string;
  currency: string;
  note_attributes?: { name: string; value: string }[];
};

type Attribution = {
  experimentId: string;
  visitorId: string;
  variantKey: "A" | "B";
};

function noteAttribute(payload: ShopifyOrderWebhook, name: string) {
  return payload.note_attributes?.find((attribute) => attribute.name === name)?.value;
}

function parseAttributions(payload: ShopifyOrderWebhook): Attribution[] {
  const visitorId = noteAttribute(payload, "ab_visitor_id");
  const encodedAssignments = noteAttribute(payload, "dml_ab_assignments");

  if (visitorId && encodedAssignments) {
    try {
      const assignments = JSON.parse(encodedAssignments) as Record<string, "A" | "B">;
      return Object.entries(assignments)
        .filter((entry): entry is [string, "A" | "B"] => entry[1] === "A" || entry[1] === "B")
        .map(([experimentId, variantKey]) => ({ experimentId, visitorId, variantKey }));
    } catch {
      return [];
    }
  }

  const experimentId = noteAttribute(payload, "ab_experiment_id");
  const variant = noteAttribute(payload, "ab_variant");

  if (!visitorId || !experimentId || !variant) return [];
  return [{ experimentId, visitorId, variantKey: variant === "B" ? "B" : "A" }];
}

export async function action({ request }: ActionFunctionArgs) {
  const { payload, topic } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return json({ ok: true, skipped: "Unhandled topic" });
  }

  const order = payload as ShopifyOrderWebhook;
  const attributions = parseAttributions(order);

  if (attributions.length === 0) {
    return json({ ok: true, skipped: "No attribution fields in note_attributes" });
  }

  const revenue = Number(order.total_price);
  const created: string[] = [];

  for (const attribution of attributions) {
    const existing = await prisma.orderAttribution.findUnique({
      where: {
        experimentId_orderId: {
          experimentId: attribution.experimentId,
          orderId: String(order.id),
        },
      },
    });

    if (existing) continue;

    await prisma.$transaction([
      prisma.orderAttribution.create({
        data: {
          orderId: String(order.id),
          visitorId: attribution.visitorId,
          experimentId: attribution.experimentId,
          variantKey: attribution.variantKey,
          revenue,
          currency: order.currency,
        },
      }),
      prisma.event.create({
        data: {
          experimentId: attribution.experimentId,
          visitorId: attribution.visitorId,
          variantKey: attribution.variantKey,
          eventType: "PURCHASE",
          eventValue: revenue,
          currency: order.currency,
          orderId: String(order.id),
          metadata: { source: "orders/create webhook" },
        },
      }),
    ]);

    created.push(attribution.experimentId);
  }

  return json({ ok: true, attributed: created.length });
}
