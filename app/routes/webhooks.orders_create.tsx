import { json, type ActionFunctionArgs } from "@remix-run/node";
import { prisma } from "../lib/db.server";

type ShopifyOrderWebhook = {
  id: number;
  total_price: string;
  currency: string;
  customer?: { id?: number };
  note_attributes?: { name: string; value: string }[];
};

export async function action({ request }: ActionFunctionArgs) {
  const payload = (await request.json()) as ShopifyOrderWebhook;

  const visitorAttr = payload.note_attributes?.find((a) => a.name === "ab_visitor_id");
  const experimentAttr = payload.note_attributes?.find((a) => a.name === "ab_experiment_id");
  const variantAttr = payload.note_attributes?.find((a) => a.name === "ab_variant");

  if (!visitorAttr || !experimentAttr || !variantAttr) {
    return json({ ok: true, skipped: "No attribution fields in note_attributes" });
  }

  const existing = await prisma.orderAttribution.findUnique({
    where: { orderId: String(payload.id) },
  });

  if (existing) return json({ ok: true, skipped: "Already attributed" });

  await prisma.orderAttribution.create({
    data: {
      orderId: String(payload.id),
      visitorId: visitorAttr.value,
      experimentId: experimentAttr.value,
      variantKey: variantAttr.value === "B" ? "B" : "A",
      revenue: Number(payload.total_price),
      currency: payload.currency,
    },
  });

  await prisma.event.create({
    data: {
      experimentId: experimentAttr.value,
      visitorId: visitorAttr.value,
      variantKey: variantAttr.value === "B" ? "B" : "A",
      eventType: "PURCHASE",
      eventValue: Number(payload.total_price),
      currency: payload.currency,
      orderId: String(payload.id),
      metadata: { source: "orders/create webhook" },
    },
  });

  return json({ ok: true });
}
