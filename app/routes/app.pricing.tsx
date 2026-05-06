import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { Badge, Banner, BlockStack, Box, Button, Card, InlineGrid, InlineStack, Page, Text, Tooltip } from "@shopify/polaris";
import { prisma } from "../lib/db.server";
import { requireShopRecord } from "../lib/shop.server";
import { getExperimentSummary, updateExperimentStatus, simulateTraffic, clearExperimentData } from "../models/experiments.server";
import { summarizeExperiment } from "../lib/analytics.server";
import { money, percent, signedPercent } from "../lib/format";

const SELECTOR_A = "#dml-badge-a";
const SELECTOR_B = "#dml-badge-b";
const EXPERIMENT_TYPE = "SHOP_PAY_BADGE";

async function findOrCreateExperiment(shopId: string, defaultTrafficSplit: number) {
  const existing = await prisma.experiment.findFirst({
    where: { shopId, type: EXPERIMENT_TYPE },
    include: { variants: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  return prisma.experiment.create({
    data: {
      shopId,
      name: "Shop Pay Badge",
      type: EXPERIMENT_TYPE,
      targetType: "ALL_PAGES",
      trafficSplitA: defaultTrafficSplit,
      status: "DRAFT",
      variants: {
        create: [
          { key: "A", selector: SELECTOR_A },
          { key: "B", selector: SELECTOR_B },
        ],
      },
    },
    include: { variants: true },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const experiment = await findOrCreateExperiment(shop.id, shop.defaultTrafficSplit);
  const summary = await getExperimentSummary(experiment.id);
  return json({
    experiment: summarizeExperiment(experiment, summary),
    certaintyThreshold: shop.certaintyThreshold,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const shop = await requireShopRecord(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const experiment = await prisma.experiment.findFirst({
    where: { shopId: shop.id, type: EXPERIMENT_TYPE },
    select: { id: true },
  });
  if (!experiment) return redirect("/app/pricing");

  if (["ACTIVE", "PAUSED", "STOPPED", "DRAFT"].includes(intent)) {
    await updateExperimentStatus({ id: experiment.id, shopId: shop.id, status: intent as any });
  } else if (intent === "simulate") {
    await simulateTraffic(experiment.id, shop.id, 50);
  } else if (intent === "clearData") {
    await clearExperimentData(experiment.id, shop.id);
  }

  return redirect("/app/pricing");
}

function statusTone(status: string): "success" | "warning" | undefined {
  if (status === "ACTIVE") return "success";
  if (status === "PAUSED") return "warning";
  return undefined;
}

function formatPValue(p: number) {
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toFixed(3)}`;
}

function Tip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip content={tip} dismissOnMouseOut>
      <span style={{ borderBottom: "1px dotted currentColor", cursor: "help" }}>{label}</span>
    </Tooltip>
  );
}

function MetricCard({ label, value, detail, tip }: { label: string; value: string; detail: string; tip?: string }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" tone="subdued">{tip ? <Tip label={label} tip={tip} /> : label}</Text>
        <Text as="p" variant="headingLg">{value}</Text>
        <Text as="p" tone="subdued">{detail}</Text>
      </BlockStack>
    </Card>
  );
}

function MiniChart({ cvrA, cvrB }: { cvrA: number; cvrB: number }) {
  const maxValue = Math.max(cvrA, cvrB, 0.01);
  const barA = Math.round((cvrA / maxValue) * 120);
  const barB = Math.round((cvrB / maxValue) * 120);
  return (
    <svg viewBox="0 0 660 220" role="img" aria-label="Conversion rate comparison" style={{ width: "100%", height: "auto" }}>
      {[40, 80, 120, 160].map((y) => <line key={y} x1="24" x2="636" y1={y} y2={y} stroke="#dfe3e8" strokeDasharray="5 5" />)}
      <rect x="170" y={170 - barA} width="120" height={barA} rx="8" fill="#111111" />
      <rect x="370" y={170 - barB} width="120" height={barB} rx="8" fill="#005bd3" />
      <text x="230" y="192" textAnchor="middle" fill="#616161" fontSize="13">No badge (A)</text>
      <text x="430" y="192" textAnchor="middle" fill="#616161" fontSize="13">Badge (B)</text>
      <text x="230" y={162 - barA} textAnchor="middle" fill="#111111" fontSize="13">{percent(cvrA)}</text>
      <text x="430" y={162 - barB} textAnchor="middle" fill="#005bd3" fontSize="13">{percent(cvrB)}</text>
    </svg>
  );
}

export default function ShopPayBadgePage() {
  const { experiment, certaintyThreshold } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const hasEnoughData = experiment.visitorsA > 0 && experiment.visitorsB > 0;
  const probabilityB =
    !hasEnoughData || experiment.winner === "Tie" ? 50 :
    experiment.winner === "B" ? experiment.certaintyScore :
    100 - experiment.certaintyScore;
  const probabilityA = 100 - probabilityB;

  const isActive = experiment.status === "ACTIVE";

  return (
    <Page
      title="Shop Pay badge test"
      subtitle="A/B test showing Shop Pay installments badge below the Add to Cart button."
    >
      <BlockStack gap="400">

{experiment.status === "DRAFT" && (
          <Banner title="Test is not active" tone="warning">
            <Text as="p" variant="bodySm">
              Add the DML Shop Pay Badge A/B block to your product template in Theme Customizer, then click Activate below.
            </Text>
          </Banner>
        )}

        <Card>
          <InlineStack align="space-between" blockAlign="center" wrap>
            <InlineStack gap="300" blockAlign="center">
              <Badge tone={statusTone(experiment.status)}>{experiment.statusLabel}</Badge>
              <Text as="p" tone="subdued">
                A {experiment.trafficSplitA}% / B {100 - experiment.trafficSplitA}%
                {" · "}
                {experiment.visitors.toLocaleString()} visitors
              </Text>
            </InlineStack>
            <InlineStack gap="200" wrap>
              {!isActive && (
                <Form method="post">
                  <input type="hidden" name="intent" value="ACTIVE" />
                  <Button submit variant="primary" loading={isSubmitting}>Activate</Button>
                </Form>
              )}
              {isActive && (
                <Form method="post">
                  <input type="hidden" name="intent" value="PAUSED" />
                  <Button submit loading={isSubmitting}>Pause</Button>
                </Form>
              )}
              {(isActive || experiment.status === "PAUSED") && (
                <Form method="post">
                  <input type="hidden" name="intent" value="STOPPED" />
                  <Button submit tone="critical" loading={isSubmitting}>Stop test</Button>
                </Form>
              )}
              {experiment.status === "STOPPED" && (
                <Form method="post">
                  <input type="hidden" name="intent" value="DRAFT" />
                  <Button submit loading={isSubmitting}>Reset to draft</Button>
                </Form>
              )}
            </InlineStack>
          </InlineStack>
        </Card>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          <MetricCard
            label="Total visitors"
            value={experiment.visitors.toLocaleString()}
            detail={`A: ${experiment.visitorsA.toLocaleString()} · B: ${experiment.visitorsB.toLocaleString()}`}
          />
          <MetricCard
            label="CVR lift"
            value={signedPercent(experiment.cvrLift)}
            detail={experiment.cvrLift > 0 ? "Badge winning" : experiment.cvrLift < 0 ? "No badge winning" : "No difference yet"}
            tip="How much better or worse the badge variant converts compared to no badge"
          />
          <MetricCard
            label="Significance"
            tip="Statistical significance — how confident we are the result is real and not random chance"
            value={experiment.significant ? "Significant" : "Not yet"}
            detail={
              experiment.significant
                ? `${formatPValue(experiment.pValue)} · ${experiment.confidence}% confident`
                : experiment.samplesNeeded > 0
                  ? `~${experiment.samplesNeeded.toLocaleString()} more visitors needed`
                  : formatPValue(experiment.pValue)
            }
          />
          <MetricCard
            label="Revenue"
            tip="Total revenue attributed to each variant via the orders/create webhook"
            value={money(experiment.revenueA + experiment.revenueB)}
            detail={`A: ${money(experiment.revenueA)} · B: ${money(experiment.revenueB)}`}
          />
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Conversion rate</Text>
              <InlineStack gap="200">
                <Badge>No badge {percent(experiment.cvrA)}</Badge>
                <Badge tone={experiment.cvrB > experiment.cvrA ? "success" : undefined}>
                  Badge {percent(experiment.cvrB)}
                </Badge>
              </InlineStack>
            </InlineStack>
            <Box paddingBlockStart="200">
              <MiniChart cvrA={experiment.cvrA} cvrB={experiment.cvrB} />
            </Box>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
          {(["A", "B"] as const).map((key) => {
            const isA = key === "A";
            const probability = isA ? probabilityA : probabilityB;
            const visitors = isA ? experiment.visitorsA : experiment.visitorsB;
            const cvr = isA ? experiment.cvrA : experiment.cvrB;
            const ctr = isA ? experiment.ctrA : experiment.ctrB;
            const atc = isA ? experiment.atcA : experiment.atcB;
            const checkoutRate = isA ? experiment.checkoutRateA : experiment.checkoutRateB;
            const rpv = isA ? experiment.rpvA : experiment.rpvB;
            return (
              <Card key={key}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">{isA ? "No badge (A)" : "Badge (B)"}</Text>
                    <Badge tone={probability >= certaintyThreshold ? "success" : undefined}>
                      {probability}% to win
                    </Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Selector: <Text as="span" fontWeight="semibold">{isA ? SELECTOR_A : SELECTOR_B}</Text>
                  </Text>
                  <InlineGrid columns={2} gap="300">
                    <Text as="p" tone="subdued">Visitors<br /><Text as="span" fontWeight="semibold">{visitors.toLocaleString()}</Text></Text>
                    <Text as="p" tone="subdued"><Tip label="CVR" tip="Conversion Rate — % of visitors who completed a purchase" /><br /><Text as="span" fontWeight="semibold">{percent(cvr)}</Text></Text>
                    <Text as="p" tone="subdued"><Tip label="CTR" tip="Click-Through Rate — % of visitors who clicked the badge element" /><br /><Text as="span" fontWeight="semibold">{percent(ctr)}</Text></Text>
                    <Text as="p" tone="subdued"><Tip label="Add to cart" tip="Add-to-Cart Rate — % of visitors who added the product to their cart" /><br /><Text as="span" fontWeight="semibold">{percent(atc)}</Text></Text>
                    <Text as="p" tone="subdued"><Tip label="Checkout" tip="Checkout Rate — % of visitors who started the checkout process" /><br /><Text as="span" fontWeight="semibold">{percent(checkoutRate)}</Text></Text>
                    <Text as="p" tone="subdued"><Tip label="RPV" tip="Revenue Per Visitor — total revenue divided by number of visitors" /><br /><Text as="span" fontWeight="semibold">{money(rpv)}</Text></Text>
                  </InlineGrid>
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>


      </BlockStack>
    </Page>
  );
}
