import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { useState } from "react";
import { Badge, Banner, BlockStack, Box, Button, Card, FormLayout, InlineGrid, InlineStack, Modal, Page, Select, Text, TextField, Tooltip } from "@shopify/polaris";
import { prisma } from "../lib/db.server";
import { requireShopRecord } from "../lib/shop.server";
import { getExperimentSummary, updateExperimentStatus, simulateTraffic, clearExperimentData } from "../models/experiments.server";
import { summarizeExperiment } from "../lib/analytics.server";
import { money, percent, signedPercent } from "../lib/format";

const SELECTOR_A = "#dml-img-a";
const SELECTOR_B = "#dml-img-b";
const EXPERIMENT_TYPE = "IMAGE_SWAP";

async function findOrCreateExperiment(shopId: string, defaultTrafficSplit: number) {
  // Prefer: ACTIVE IMAGE_SWAP → ACTIVE any → most-recent IMAGE_SWAP → most-recent any
  const activeImageSwap = await prisma.experiment.findFirst({
    where: { shopId, status: "ACTIVE", type: EXPERIMENT_TYPE },
    include: { variants: true },
    orderBy: { createdAt: "desc" },
  });
  if (activeImageSwap) return activeImageSwap;

  const activeAny = await prisma.experiment.findFirst({
    where: { shopId, status: "ACTIVE", type: null, variants: { some: { selector: SELECTOR_A } } },
    include: { variants: true },
    orderBy: { createdAt: "desc" },
  });
  if (activeAny) return activeAny;

  const existing = await prisma.experiment.findFirst({
    where: { shopId, OR: [{ type: EXPERIMENT_TYPE }, { type: null, variants: { some: { selector: SELECTOR_A } } }] },
    include: { variants: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  return prisma.experiment.create({
    data: {
      shopId,
      name: "Image Swap",
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
  // Clear stale endsAt from any previously-stopped-then-reactivated experiments
  await prisma.experiment.updateMany({
    where: { shopId: shop.id, status: "ACTIVE", endsAt: { lt: new Date() } },
    data: { endsAt: null },
  });
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
  let experiment =
    (await prisma.experiment.findFirst({
      where: { shopId: shop.id, status: "ACTIVE", type: EXPERIMENT_TYPE },
      select: { id: true },
    })) ??
    (await prisma.experiment.findFirst({
      where: { shopId: shop.id, status: "ACTIVE", type: null, variants: { some: { selector: SELECTOR_A } } },
      select: { id: true },
    })) ??
    (await prisma.experiment.findFirst({
      where: { shopId: shop.id, OR: [{ type: EXPERIMENT_TYPE }, { type: null, variants: { some: { selector: SELECTOR_A } } }] },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    }));
  if (!experiment) return redirect("/app");

  if (["ACTIVE", "PAUSED", "STOPPED", "DRAFT"].includes(intent)) {
    await updateExperimentStatus({ id: experiment.id, shopId: shop.id, status: intent as any });
  } else if (intent === "simulate") {
    await simulateTraffic(experiment.id, shop.id, 50);
  } else if (intent === "clearData") {
    await clearExperimentData(experiment.id, shop.id);
  } else if (intent === "updateSettings") {
    const audienceRule = String(formData.get("audienceRule") ?? "ALL_VISITORS");
    const trafficSplitA = Number(formData.get("trafficSplitA") ?? 50);
    await prisma.experiment.update({
      where: { id: experiment.id },
      data: {
        audienceRule: audienceRule as any,
        trafficSplitA: Math.min(99, Math.max(1, trafficSplitA)),
        endsAt: null,
      },
    });
  }

  return redirect("/app");
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
      <text x="230" y="192" textAnchor="middle" fill="#616161" fontSize="13">Original (A)</text>
      <text x="430" y="192" textAnchor="middle" fill="#616161" fontSize="13">Variant (B)</text>
      <text x="230" y={162 - barA} textAnchor="middle" fill="#111111" fontSize="13">{percent(cvrA)}</text>
      <text x="430" y={162 - barB} textAnchor="middle" fill="#005bd3" fontSize="13">{percent(cvrB)}</text>
    </svg>
  );
}

const AUDIENCE_OPTIONS = [
  { label: "All visitors", value: "ALL_VISITORS" },
  { label: "New visitors only", value: "NEW_VISITORS" },
  { label: "Returning visitors only", value: "RETURNING_VISITORS" },
];

function TestSettingsCard({
  audienceRule,
  trafficSplitA,
  isSubmitting,
}: {
  audienceRule: string;
  trafficSplitA: number;
  isSubmitting: boolean;
}) {
  const [audience, setAudience] = useState(audienceRule);
  const [split, setSplit] = useState(String(trafficSplitA));

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="intent" value="updateSettings" />
        <FormLayout>
          <Text as="h2" variant="headingMd">Test settings</Text>
          <Select
            label="Audience"
            name="audienceRule"
            options={AUDIENCE_OPTIONS}
            value={audience}
            onChange={setAudience}
            helpText="Which visitors are included in the test."
          />
          <TextField
            label="Traffic split — Original (A)"
            name="trafficSplitA"
            type="number"
            min={1}
            max={99}
            suffix="%"
            autoComplete="off"
            value={split}
            onChange={setSplit}
            helpText={`Variant B gets ${100 - Number(split || 50)}%. 50 means an even split.`}
          />
          <Button submit variant="primary" loading={isSubmitting}>Save settings</Button>
        </FormLayout>
      </Form>
    </Card>
  );
}

export default function ImageSwapPage() {
  const { experiment, certaintyThreshold } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === "submitting";
  const [showClearModal, setShowClearModal] = useState(false);

  const hasEnoughData = experiment.visitorsA > 0 && experiment.visitorsB > 0;
  const probabilityB =
    !hasEnoughData || experiment.winner === "Tie" ? 50 :
    experiment.winner === "B" ? experiment.certaintyScore :
    100 - experiment.certaintyScore;
  const probabilityA = 100 - probabilityB;

  const isActive = experiment.status === "ACTIVE";

  return (
    <Page
      title="Image swap test"
      subtitle="A/B test original vs variant product image on the Packages section."
    >
      <BlockStack gap="400">

{experiment.status === "DRAFT" && (
          <Banner title="Test is not active" tone="warning">
            <Text as="p" variant="bodySm">
              In Theme Customizer → Packages section → tick "Enable image A/B test" on the block, upload Variant B image, then click Activate below.
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
            detail={experiment.cvrLift > 0 ? "Variant B winning" : experiment.cvrLift < 0 ? "Original A winning" : "No difference yet"}
            tip="How much better or worse Variant B converts compared to Original A"
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
                <Badge>Original {percent(experiment.cvrA)}</Badge>
                <Badge tone={experiment.cvrB > experiment.cvrA ? "success" : undefined}>
                  Variant {percent(experiment.cvrB)}
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
                    <Text as="h2" variant="headingMd">{isA ? "Original (A)" : "Variant (B)"}</Text>
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
                    <Text as="p" tone="subdued"><Tip label="CTR" tip="Click-Through Rate — % of visitors who clicked the product image" /><br /><Text as="span" fontWeight="semibold">{percent(ctr)}</Text></Text>
                    <Text as="p" tone="subdued"><Tip label="Add to cart" tip="Add-to-Cart Rate — % of visitors who added the product to their cart" /><br /><Text as="span" fontWeight="semibold">{percent(atc)}</Text></Text>
                    <Text as="p" tone="subdued"><Tip label="Checkout" tip="Checkout Rate — % of visitors who started the checkout process" /><br /><Text as="span" fontWeight="semibold">{percent(checkoutRate)}</Text></Text>
                    <Text as="p" tone="subdued"><Tip label="RPV" tip="Revenue Per Visitor — total revenue divided by number of visitors" /><br /><Text as="span" fontWeight="semibold">{money(rpv)}</Text></Text>
                  </InlineGrid>
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>

        <TestSettingsCard
          audienceRule={experiment.audienceRule}
          trafficSplitA={experiment.trafficSplitA}
          isSubmitting={isSubmitting}
        />

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Danger zone</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Permanently delete all visitors, events, and revenue data for this test. This cannot be undone.
            </Text>
            <InlineStack>
              <Button tone="critical" onClick={() => setShowClearModal(true)}>Clear all data</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Modal
          open={showClearModal}
          onClose={() => setShowClearModal(false)}
          title="Clear all test data?"
          primaryAction={{
            content: "Clear all data",
            destructive: true,
            loading: isSubmitting,
            onAction: () => {
              const fd = new FormData();
              fd.append("intent", "clearData");
              submit(fd, { method: "post" });
              setShowClearModal(false);
            },
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setShowClearModal(false) }]}
        >
          <Modal.Section>
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                This will permanently delete all <strong>{experiment.visitors.toLocaleString()} visitors</strong>, impressions, add-to-cart, checkout, and revenue records for this test. The test itself will remain but all collected data will be gone.
              </Text>
            </Banner>
          </Modal.Section>
        </Modal>

      </BlockStack>
    </Page>
  );
}
