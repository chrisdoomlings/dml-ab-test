import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Badge, Card, Page, Text } from "@shopify/polaris";
import { getExperimentSummary } from "../models/experiments.server";
import { prisma } from "../lib/db.server";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const experiment = await prisma.experiment.findFirst({
    where: { id, shopId: shop.id },
    include: { variants: true },
  });
  if (!experiment) throw new Response("Not found", { status: 404 });

  const summary = await getExperimentSummary(id);
  return json({ experiment, summary });
}

function metricCount(
  summary: Awaited<ReturnType<typeof getExperimentSummary>>,
  variantKey: "A" | "B",
  eventType: "IMPRESSION" | "CLICK" | "ADD_TO_CART" | "CHECKOUT_STARTED" | "PURCHASE",
) {
  return (
    summary.events.find((e) => e.variantKey === variantKey && e.eventType === eventType)?._count._all ?? 0
  );
}

export default function ExperimentDetailsPage() {
  const { experiment, summary } = useLoaderData<typeof loader>();
  const visitorsA = summary.assignments.find((a) => a.variantKey === "A")?._count._all ?? 0;
  const visitorsB = summary.assignments.find((a) => a.variantKey === "B")?._count._all ?? 0;
  const clicksA = metricCount(summary, "A", "CLICK");
  const clicksB = metricCount(summary, "B", "CLICK");
  const impressionsA = metricCount(summary, "A", "IMPRESSION");
  const impressionsB = metricCount(summary, "B", "IMPRESSION");
  const purchasesA = metricCount(summary, "A", "PURCHASE");
  const purchasesB = metricCount(summary, "B", "PURCHASE");
  const revA = summary.attributions.find((a) => a.variantKey === "A")?._sum.revenue ?? 0;
  const revB = summary.attributions.find((a) => a.variantKey === "B")?._sum.revenue ?? 0;

  const crA = visitorsA > 0 ? (purchasesA / visitorsA) * 100 : 0;
  const crB = visitorsB > 0 ? (purchasesB / visitorsB) * 100 : 0;
  const ctrA = impressionsA > 0 ? (clicksA / impressionsA) * 100 : 0;
  const ctrB = impressionsB > 0 ? (clicksB / impressionsB) * 100 : 0;
  const winner = crA === crB ? "Tie" : crA > crB ? "A" : "B";

  return (
    <Page title={experiment.name}>
      <Card>
        <div style={{ padding: 16 }}>
          <Text as="p" variant="bodyMd">
            Status: <Badge>{experiment.status}</Badge>
          </Text>
          <Text as="p" variant="bodyMd">
            Visitors A/B: {visitorsA} / {visitorsB}
          </Text>
          <Text as="p" variant="bodyMd">
            Impressions A/B: {impressionsA} / {impressionsB}
          </Text>
          <Text as="p" variant="bodyMd">
            Clicks A/B: {clicksA} / {clicksB}
          </Text>
          <Text as="p" variant="bodyMd">
            CTR A/B: {ctrA.toFixed(2)}% / {ctrB.toFixed(2)}%
          </Text>
          <Text as="p" variant="bodyMd">
            Purchases A/B: {purchasesA} / {purchasesB}
          </Text>
          <Text as="p" variant="bodyMd">
            Conversion A/B: {crA.toFixed(2)}% / {crB.toFixed(2)}%
          </Text>
          <Text as="p" variant="bodyMd">
            Revenue A/B: {revA.toFixed(2)} / {revB.toFixed(2)}
          </Text>
          <Text as="p" variant="headingMd">
            Winning variant: {winner}
          </Text>
        </div>
      </Card>
    </Page>
  );
}
