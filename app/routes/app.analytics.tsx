import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Box, Button, Card, InlineGrid, InlineStack, Page, Text } from "@shopify/polaris";
import { listExperimentAnalytics, metricTotals, totals } from "../lib/analytics.server";
import { money, percent, signedPercent } from "../lib/format";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const experiments = await listExperimentAnalytics(shop.id);
  return json({
    experiments,
    summary: totals(experiments),
    events: metricTotals(experiments),
  });
}

function ReportingChart() {
  const original = [0.74, 0.58, 0.64, 0.49, 0.53, 0.62, 0.7, 0.59, 0.66];
  const variant = [0.86, 0.78, 0.73, 0.66, 0.44, 0.38, 0.52, 0.61, 0.57];
  const toPath = (points: number[]) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${28 + index * 76} ${26 + point * 150}`).join(" ");

  return (
    <svg className="native-chart" viewBox="0 0 680 240" role="img" aria-label="Reporting trend">
      {[42, 92, 142, 192].map((y) => (
        <line key={y} x1="28" x2="652" y1={y} y2={y} stroke="#dfe3e8" strokeDasharray="5 5" />
      ))}
      <path d={toPath(original)} fill="none" stroke="#111111" strokeWidth="3" />
      <path d={toPath(variant)} fill="none" stroke="#005bd3" strokeWidth="3" />
      <text x="28" y="226" fill="#616161" fontSize="13">Original</text>
      <text x="112" y="226" fill="#005bd3" fontSize="13">Variant</text>
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

export default function AnalyticsPage() {
  const { experiments, summary, events } = useLoaderData<typeof loader>();
  const averageLift = summary.tests > 0 ? summary.lift / summary.tests : 0;

  return (
    <Page
      title="Analytics"
      subtitle="Compare conversion, add-to-cart, revenue, and certainty across every test."
      primaryAction={{ content: "Create test", url: "/app/experiments/new" }}
      backAction={{ content: "Tests", url: "/app" }}
    >
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          <MetricCard label="Tests analyzed" value={String(summary.tests)} detail={`${summary.live} live now`} />
          <MetricCard label="Visitor sample" value={summary.visitors.toLocaleString()} detail={`${events.IMPRESSION.toLocaleString()} impressions`} />
          <MetricCard label="Average lift" value={signedPercent(averageLift)} detail="Conversion rate goal" />
          <MetricCard label="Revenue tracked" value={money(summary.revenue)} detail={`${events.PURCHASE.toLocaleString()} purchases`} />
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Conversion rate trend</Text>
              <InlineStack gap="200">
                <Badge>Clicks {events.CLICK.toLocaleString()}</Badge>
                <Badge>Adds {events.ADD_TO_CART.toLocaleString()}</Badge>
              </InlineStack>
            </InlineStack>
            <ReportingChart />
          </BlockStack>
        </Card>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Experiment performance</Text>
              <Badge tone="success">Certainty model</Badge>
            </InlineStack>
          </Box>
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Visitors</th>
                <th>CVR</th>
                <th>Lift</th>
                <th>Revenue</th>
                <th>RPV</th>
                <th>Certainty</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((experiment) => (
                <tr key={experiment.id}>
                  <td><Link to={`/app/experiments/${experiment.id}`}>{experiment.name}</Link></td>
                  <td>{experiment.visitors.toLocaleString()}</td>
                  <td>{percent(experiment.cvrB)}</td>
                  <td><Badge tone={experiment.cvrLift >= 0 ? "success" : "critical"}>{signedPercent(experiment.cvrLift)}</Badge></td>
                  <td>{money(experiment.revenueA + experiment.revenueB)}</td>
                  <td>{money(experiment.rpvB)}</td>
                  <td>{experiment.certaintyScore}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </BlockStack>
    </Page>
  );
}
