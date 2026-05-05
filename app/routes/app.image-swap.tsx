import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { Badge, Banner, BlockStack, Box, Button, Card, InlineGrid, InlineStack, Page, Text } from "@shopify/polaris";
import { prisma } from "../lib/db.server";
import { requireShopRecord } from "../lib/shop.server";
import { getExperimentSummary, updateExperimentStatus, simulateTraffic, clearExperimentData } from "../models/experiments.server";
import { summarizeExperiment } from "../lib/analytics.server";
import { money, percent, signedPercent } from "../lib/format";

const SELECTOR_A = "#dml-img-a";
const SELECTOR_B = "#dml-img-b";
const EXPERIMENT_TYPE = "IMAGE_SWAP";

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
  if (!experiment) return redirect("/app/image-swap");

  if (["ACTIVE", "PAUSED", "STOPPED", "DRAFT"].includes(intent)) {
    await updateExperimentStatus({ id: experiment.id, shopId: shop.id, status: intent as any });
  } else if (intent === "simulate") {
    await simulateTraffic(experiment.id, shop.id, 50);
  } else if (intent === "clearData") {
    await clearExperimentData(experiment.id, shop.id);
  }

  return redirect("/app/image-swap");
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

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" tone="subdued">{label}</Text>
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

export default function ImageSwapPage() {
  const { experiment, certaintyThreshold } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const probabilityB =
    experiment.winner === "Tie" ? 50 :
    experiment.winner === "B" ? experiment.certaintyScore :
    100 - experiment.certaintyScore;
  const probabilityA = 100 - probabilityB;

  const isActive = experiment.status === "ACTIVE";
  const hasSufficientData = experiment.visitors >= 10;

  return (
    <Page
      title="Image swap test"
      subtitle="A/B test original vs variant product image on the Packages section."
    >
      <BlockStack gap="400">

        {experiment.status === "DRAFT" && (
          <Banner
            title="Test is not active"
            tone="warning"
            action={{ content: "Activate now", onAction: () => {} }}
          >
            <Text as="p" variant="bodySm">
              In Theme Customizer → Packages section → enable "A/B test" on the block, set both images, then activate the test here.
            </Text>
          </Banner>
        )}

        {/* Controls */}
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

        {/* Key metrics */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          <MetricCard
            label="Total visitors"
            value={experiment.visitors.toLocaleString()}
            detail={`A: ${experiment.visitorsA.toLocaleString()} · B: ${experiment.visitorsB.toLocaleString()}`}
          />
          <MetricCard
            label="CVR lift"
            value={signedPercent(experiment.cvrLift)}
            detail={experiment.cvrLift > 0 ? "Variant B is winning" : experiment.cvrLift < 0 ? "Original A is winning" : "No difference yet"}
          />
          <MetricCard
            label="Statistical significance"
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
            value={money(experiment.revenueA + experiment.revenueB)}
            detail="Requires read_orders approval"
          />
        </InlineGrid>

        {/* Conversion chart */}
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

        {/* Variant breakdown */}
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
          {(["A", "B"] as const).map((key) => {
            const isA = key === "A";
            const probability = isA ? probabilityA : probabilityB;
            const visitors = isA ? experiment.visitorsA : experiment.visitorsB;
            const cvr = isA ? experiment.cvrA : experiment.cvrB;
            const ctr = isA ? experiment.ctrA : experiment.ctrB;
            const atc = isA ? experiment.atcA : experiment.atcB;
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
                    <Text as="p" tone="subdued">CVR<br /><Text as="span" fontWeight="semibold">{percent(cvr)}</Text></Text>
                    <Text as="p" tone="subdued">CTR<br /><Text as="span" fontWeight="semibold">{percent(ctr)}</Text></Text>
                    <Text as="p" tone="subdued">Add to cart<br /><Text as="span" fontWeight="semibold">{percent(atc)}</Text></Text>
                    <Text as="p" tone="subdued">RPV<br /><Text as="span" fontWeight="semibold">{money(rpv)}</Text></Text>
                  </InlineGrid>
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>

        {/* Simulate / clear */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Test data</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Simulate 50 fake visitors to preview how the dashboard looks with data. Clear removes all analytics records for this test.
            </Text>
            <InlineStack gap="200">
              <Form method="post">
                <input type="hidden" name="intent" value="simulate" />
                <Button submit loading={isSubmitting} variant="primary">Simulate 50 visitors</Button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="clearData" />
                <Button submit tone="critical" loading={isSubmitting}>Clear all data</Button>
              </Form>
            </InlineStack>
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}
