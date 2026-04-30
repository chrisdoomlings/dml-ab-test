import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { ExperimentStatus } from "@prisma/client";
import { Badge, Button, ButtonGroup, Card, Page, Text } from "@shopify/polaris";
import {
  deleteExperiment,
  getExperimentSummary,
  updateExperimentStatus,
} from "../models/experiments.server";
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

export async function action({ request, params }: ActionFunctionArgs) {
  const shop = await requireShopRecord(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "delete") {
    await deleteExperiment({ id, shopId: shop.id });
    return redirect("/app");
  }

  if (["DRAFT", "ACTIVE", "PAUSED", "STOPPED"].includes(intent)) {
    await updateExperimentStatus({
      id,
      shopId: shop.id,
      status: intent as ExperimentStatus,
    });
    return redirect(`/app/experiments/${id}`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

function metricCount(
  summary: Awaited<ReturnType<typeof getExperimentSummary>>,
  variantKey: "A" | "B",
  eventType: "IMPRESSION" | "CLICK" | "ADD_TO_CART" | "CHECKOUT_STARTED" | "PURCHASE",
) {
  return summary.events.find((e) => e.variantKey === variantKey && e.eventType === eventType)?._count._all ?? 0;
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

export default function ExperimentDetailsPage() {
  const { experiment, summary } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const visitorsA = summary.assignments.find((a) => a.variantKey === "A")?._count._all ?? 0;
  const visitorsB = summary.assignments.find((a) => a.variantKey === "B")?._count._all ?? 0;
  const clicksA = metricCount(summary, "A", "CLICK");
  const clicksB = metricCount(summary, "B", "CLICK");
  const impressionsA = metricCount(summary, "A", "IMPRESSION");
  const impressionsB = metricCount(summary, "B", "IMPRESSION");
  const addsA = metricCount(summary, "A", "ADD_TO_CART");
  const addsB = metricCount(summary, "B", "ADD_TO_CART");
  const purchasesA = metricCount(summary, "A", "PURCHASE");
  const purchasesB = metricCount(summary, "B", "PURCHASE");
  const revA = summary.attributions.find((a) => a.variantKey === "A")?._sum.revenue ?? 0;
  const revB = summary.attributions.find((a) => a.variantKey === "B")?._sum.revenue ?? 0;

  const crA = rate(purchasesA, visitorsA);
  const crB = rate(purchasesB, visitorsB);
  const ctrA = rate(clicksA, impressionsA);
  const ctrB = rate(clicksB, impressionsB);
  const winner = crA === crB ? "Tie" : crA > crB ? "A" : "B";

  const selectorA = experiment.variants.find((variant) => variant.key === "A")?.selector ?? "";
  const selectorB = experiment.variants.find((variant) => variant.key === "B")?.selector ?? "";

  return (
    <Page title={experiment.name} backAction={{ content: "Experiments", url: "/app" }}>
      <div style={{ display: "grid", gap: 16 }}>
        <Card>
          <div style={{ padding: 16, display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <Text as="p" variant="bodyMd">
                Status: <Badge>{experiment.status}</Badge>
              </Text>
              <Form method="post">
                <ButtonGroup>
                  <Button submit name="intent" value="ACTIVE" disabled={isSubmitting || experiment.status === "ACTIVE"}>
                    Activate
                  </Button>
                  <Button submit name="intent" value="PAUSED" disabled={isSubmitting || experiment.status === "PAUSED"}>
                    Pause
                  </Button>
                  <Button submit name="intent" value="STOPPED" disabled={isSubmitting || experiment.status === "STOPPED"}>
                    Stop
                  </Button>
                  <Button submit name="intent" value="delete" tone="critical" disabled={isSubmitting}>
                    Delete
                  </Button>
                </ButtonGroup>
              </Form>
            </div>
            <Text as="p" variant="bodySm" tone="subdued">
              Target: {experiment.targetType}
              {experiment.targetValue ? ` (${experiment.targetValue})` : ""}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Variant selectors: A {selectorA}, B {selectorB}
            </Text>
          </div>
        </Card>

        <Card>
          <div style={{ padding: 16, display: "grid", gap: 8 }}>
            <Text as="h2" variant="headingMd">
              Results
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
              Add to cart A/B: {addsA} / {addsB}
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
      </div>
    </Page>
  );
}
