import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { Badge, BlockStack, Box, Button, Card, InlineGrid, InlineStack, Page, Text } from "@shopify/polaris";
import { listExperimentAnalytics, totals } from "../lib/analytics.server";
import { money, percent, signedPercent } from "../lib/format";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const experiments = await listExperimentAnalytics(shop.id);
  const summary = totals(experiments);
  return json({ experiments, summary });
}

function targetLabel(targetType: string, targetValue?: string | null) {
  if (targetType === "ALL_PAGES") return "All pages";
  if (targetType === "TEMPLATE") return `${targetValue || "Template"} template`;
  if (targetType === "PATH_PREFIX") return `${targetValue || "Path"} prefix`;
  return targetValue || "Exact path";
}

function dateLabel(value: string | Date | null) {
  if (!value) return "Not started";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status: string): "success" | "info" | "warning" | undefined {
  if (status === "Live") return "success";
  if (status === "Draft") return "info";
  if (status === "Paused") return "warning";
  return undefined;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
        <Text as="p" tone="subdued">
          {detail}
        </Text>
      </BlockStack>
    </Card>
  );
}

export default function AppIndex() {
  const { experiments, summary } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") ?? "live";
  const filtered = experiments.filter((experiment) => {
    if (currentTab === "draft") return experiment.status === "DRAFT";
    if (currentTab === "ended") return experiment.status === "STOPPED";
    return experiment.status === "ACTIVE" || experiment.status === "PAUSED";
  });
  const averageLift = summary.tests > 0 ? summary.lift / summary.tests : 0;

  return (
    <Page
      title="Tests"
      subtitle="Monitor live A/B tests, certainty, conversion lift, and revenue impact."
      primaryAction={{ content: "Create test", url: "/app/experiments/new" }}
      secondaryActions={[{ content: "Reporting", url: "/app/analytics" }]}
    >
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          <MetricCard label="Live tests" value={String(summary.live)} detail={`${summary.tests} total tests`} />
          <MetricCard label="Visitors assigned" value={summary.visitors.toLocaleString()} detail="Across all variants" />
          <MetricCard label="Average CVR lift" value={signedPercent(averageLift)} detail="Variant vs original" />
          <MetricCard label="Attributed revenue" value={money(summary.revenue)} detail="Orders data after approval" />
        </InlineGrid>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200">
                <Button url="/app?tab=live" variant={currentTab === "live" ? "primary" : "secondary"}>
                  Live
                </Button>
                <Button url="/app?tab=draft" variant={currentTab === "draft" ? "primary" : "secondary"}>
                  Draft
                </Button>
                <Button url="/app?tab=ended" variant={currentTab === "ended" ? "primary" : "secondary"}>
                  Ended
                </Button>
              </InlineStack>
              <Text as="p" tone="subdued">
                {filtered.length} tests
              </Text>
            </InlineStack>
          </Box>

          {filtered.length === 0 ? (
            <Box padding="800">
              <BlockStack gap="200" align="center">
                <Text as="h2" variant="headingMd">
                  No tests in this view
                </Text>
                <Text as="p" tone="subdued">
                  Create a test or switch tabs to inspect existing experiments.
                </Text>
                <Button url="/app/experiments/new" variant="primary">
                  Create test
                </Button>
              </BlockStack>
            </Box>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Started</th>
                  <th>Lift</th>
                  <th>Certainty</th>
                  <th>CVR</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((experiment) => (
                  <tr key={experiment.id}>
                    <td>
                      <BlockStack gap="100">
                        <Link to={`/app/experiments/${experiment.id}`}>{experiment.name}</Link>
                        <InlineStack gap="150">
                          <Badge tone={statusTone(experiment.statusLabel)}>{experiment.statusLabel}</Badge>
                          <Badge>{targetLabel(experiment.targetType, experiment.targetValue)}</Badge>
                          <Badge>
                            A {experiment.trafficSplitA}% / B {100 - experiment.trafficSplitA}%
                          </Badge>
                        </InlineStack>
                      </BlockStack>
                    </td>
                    <td>{dateLabel(experiment.startedAt || experiment.createdAt)}</td>
                    <td>
                      <Badge tone={experiment.cvrLift >= 0 ? "success" : "critical"}>
                        {signedPercent(experiment.cvrLift)}
                      </Badge>
                    </td>
                    <td>
                      <BlockStack gap="050">
                        <Badge tone={experiment.significant ? "success" : undefined}>
                          {experiment.significant ? "Significant" : "Gathering data"}
                        </Badge>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {experiment.pValue < 0.001 ? "p < 0.001" : `p = ${experiment.pValue.toFixed(3)}`}
                        </Text>
                      </BlockStack>
                    </td>
                    <td>{percent(experiment.cvrB)} variant</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
