import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { ExperimentStatus } from "@prisma/client";
import { Badge, BlockStack, Box, Button, ButtonGroup, Card, InlineGrid, InlineStack, Page, Text } from "@shopify/polaris";
import { deleteExperiment, getExperimentSummary, updateExperimentStatus } from "../models/experiments.server";
import { summarizeExperiment } from "../lib/analytics.server";
import { money, percent, signedPercent } from "../lib/format";
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
  return json({ experiment: summarizeExperiment(experiment, summary) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const shop = await requireShopRecord(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? formData.get("_action") ?? "");

  if (intent === "delete") {
    await deleteExperiment({ id, shopId: shop.id });
    return redirect("/app");
  }

  if (["DRAFT", "ACTIVE", "PAUSED", "STOPPED"].includes(intent)) {
    await updateExperimentStatus({ id, shopId: shop.id, status: intent as ExperimentStatus });
    return redirect(`/app/experiments/${id}`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

function selectorFor(experiment: ReturnType<typeof useLoaderData<typeof loader>>["experiment"], key: "A" | "B") {
  return experiment.variants.find((variant) => variant.key === key)?.selector ?? "No selector";
}

function assignmentModeLabel(mode: string, ttlDays: number | null) {
  if (mode === "SESSION") return "Per session";
  if (ttlDays && ttlDays > 0) return `Sticky, re-randomize every ${ttlDays} day${ttlDays > 1 ? "s" : ""}`;
  return "Sticky forever";
}

function audienceRuleLabel(rule: string) {
  if (rule === "NEW_VISITORS") return "New visitors only";
  if (rule === "RETURNING_VISITORS") return "Returning visitors only";
  return "All visitors";
}

function dateTimeLabel(value: string | Date | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function MiniChart({ cvrA, cvrB }: { cvrA: number; cvrB: number }) {
  const maxValue = Math.max(cvrA, cvrB, 0.01);
  const barHeightA = Math.round((cvrA / maxValue) * 120);
  const barHeightB = Math.round((cvrB / maxValue) * 120);

  return (
    <svg className="native-chart" viewBox="0 0 660 220" role="img" aria-label="Conversion rate comparison">
      {[40, 80, 120, 160].map((y) => <line key={y} x1="24" x2="636" y1={y} y2={y} stroke="#dfe3e8" strokeDasharray="5 5" />)}
      <rect x="170" y={170 - barHeightA} width="120" height={barHeightA} rx="8" fill="#111111" />
      <rect x="370" y={170 - barHeightB} width="120" height={barHeightB} rx="8" fill="#005bd3" />
      <text x="230" y="192" textAnchor="middle" fill="#616161" fontSize="13">Original</text>
      <text x="430" y="192" textAnchor="middle" fill="#616161" fontSize="13">Variant</text>
      <text x="230" y={162 - barHeightA} textAnchor="middle" fill="#111111" fontSize="13">{percent(cvrA)}</text>
      <text x="430" y={162 - barHeightB} textAnchor="middle" fill="#005bd3" fontSize="13">{percent(cvrB)}</text>
    </svg>
  );
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

function VariantCard({
  title,
  probability,
  selector,
  variant,
  visitors,
  ctr,
  atc,
  rpv,
}: {
  title: string;
  probability: number;
  selector: string;
  variant: "A" | "B";
  visitors: number;
  ctr: number;
  atc: number;
  rpv: number;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">{title}</Text>
          <Badge tone={probability >= 85 ? "success" : undefined}>Probability to win: {probability}%</Badge>
        </InlineStack>
        <div className={`variant-preview ${variant === "B" ? "variant-b" : ""}`}>
          <span className="preview-label">{selector}</span>
        </div>
        <InlineGrid columns={2} gap="300">
          <Text as="p" tone="subdued">Visitors<br /><Text as="span" fontWeight="semibold">{visitors.toLocaleString()}</Text></Text>
          <Text as="p" tone="subdued">CTR<br /><Text as="span" fontWeight="semibold">{percent(ctr)}</Text></Text>
          <Text as="p" tone="subdued">Add to cart<br /><Text as="span" fontWeight="semibold">{percent(atc)}</Text></Text>
          <Text as="p" tone="subdued">RPV<br /><Text as="span" fontWeight="semibold">{money(rpv)}</Text></Text>
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}

export default function ExperimentDetailsPage() {
  const { experiment } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const probabilityB = experiment.winner === "B" ? experiment.certaintyScore : 100 - experiment.certaintyScore;
  const probabilityA = 100 - probabilityB;

  return (
    <Page
      title={experiment.name}
      subtitle={`${experiment.statusLabel} test on ${experiment.targetValue || experiment.targetType.toLowerCase().replace("_", " ")}`}
      backAction={{ content: "Tests", url: "/app" }}
    >
      <BlockStack gap="400">
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={experiment.status === "ACTIVE" ? "success" : undefined}>{experiment.statusLabel}</Badge>
              <Text as="p" tone="subdued">A {experiment.trafficSplitA}% / B {100 - experiment.trafficSplitA}%</Text>
            </InlineStack>
            <Form method="post">
              <ButtonGroup>
                <input type="hidden" name="intent" value="ACTIVE" />
                <Button submit disabled={isSubmitting || experiment.status === "ACTIVE"}>Activate</Button>
              </ButtonGroup>
            </Form>
            <Form method="post">
              <ButtonGroup>
                <input type="hidden" name="intent" value="PAUSED" />
                <Button submit disabled={isSubmitting || experiment.status === "PAUSED"}>Pause</Button>
              </ButtonGroup>
            </Form>
            <Form method="post">
              <ButtonGroup>
                <input type="hidden" name="intent" value="STOPPED" />
                <Button submit disabled={isSubmitting || experiment.status === "STOPPED"}>Stop</Button>
              </ButtonGroup>
            </Form>
            <Form method="post">
              <ButtonGroup>
                <input type="hidden" name="intent" value="delete" />
                <Button submit tone="critical" disabled={isSubmitting}>Delete</Button>
              </ButtonGroup>
            </Form>
          </InlineStack>
        </Card>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          <MetricCard label="Visitors" value={experiment.visitors.toLocaleString()} detail={`A ${experiment.visitorsA.toLocaleString()} / B ${experiment.visitorsB.toLocaleString()}`} />
          <MetricCard label="Lift" value={signedPercent(experiment.cvrLift)} detail="Conversion rate goal" />
          <MetricCard label="Progress" value={experiment.certaintyScore >= 85 ? "Significant" : "Learning"} detail={`${experiment.certaintyScore}% certainty`} />
          <MetricCard label="Revenue" value={money(experiment.revenueA + experiment.revenueB)} detail="Orders data after approval" />
        </InlineGrid>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Experiment rules</Text>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="200">
              <Text as="p" tone="subdued">Assignment<br /><Text as="span" fontWeight="semibold">{assignmentModeLabel(experiment.assignmentMode, experiment.assignmentTtlDays)}</Text></Text>
              <Text as="p" tone="subdued">Audience<br /><Text as="span" fontWeight="semibold">{audienceRuleLabel(experiment.audienceRule)}</Text></Text>
              <Text as="p" tone="subdued">Starts at<br /><Text as="span" fontWeight="semibold">{dateTimeLabel(experiment.startedAt)}</Text></Text>
              <Text as="p" tone="subdued">Ends at<br /><Text as="span" fontWeight="semibold">{dateTimeLabel(experiment.endedAt)}</Text></Text>
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Conversion rate</Text>
              <InlineStack gap="200">
                <Badge>Original {percent(experiment.cvrA)}</Badge>
                <Badge>Variant {percent(experiment.cvrB)}</Badge>
              </InlineStack>
            </InlineStack>
            <Box paddingBlockStart="200">
              <MiniChart cvrA={experiment.cvrA} cvrB={experiment.cvrB} />
            </Box>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
          <VariantCard title="Original" probability={probabilityA} selector={selectorFor(experiment, "A")} variant="A" visitors={experiment.visitorsA} ctr={experiment.ctrA} atc={experiment.atcA} rpv={experiment.rpvA} />
          <VariantCard title="Variant" probability={probabilityB} selector={selectorFor(experiment, "B")} variant="B" visitors={experiment.visitorsB} ctr={experiment.ctrB} atc={experiment.atcB} rpv={experiment.rpvB} />
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
