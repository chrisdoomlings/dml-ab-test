import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Button, Card, InlineGrid, InlineStack, Page, Text } from "@shopify/polaris";
import { listExperimentAnalytics } from "../lib/analytics.server";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const experiments = await listExperimentAnalytics(shop.id);
  const liveCount = experiments.filter((experiment) => experiment.status === "ACTIVE").length;
  return json({ liveCount });
}

const ideas = [
  ["Homepage hero offer test", "CVR", "Homepage", "+8% to +18%"],
  ["Collection product-card density", "CTR", "Collection page", "+5% to +12%"],
  ["Sticky add-to-cart proof point", "ATC", "Product page", "+4% to +10%"],
  ["Announcement bar urgency", "RPV", "All pages", "+3% to +9%"],
];

export default function AssistPage() {
  const { liveCount } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Lift Assist"
      subtitle="Prioritized test ideas for conversion, product discovery, and revenue-per-visitor gains."
      primaryAction={{ content: "Create test", url: "/app/experiments/new" }}
    >
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          <Card><BlockStack gap="200"><Text as="p" tone="subdued">Live coverage</Text><Text as="p" variant="headingLg">{liveCount}</Text><Text as="p" tone="subdued">Active tests running</Text></BlockStack></Card>
          <Card><BlockStack gap="200"><Text as="p" tone="subdued">Recommended queue</Text><Text as="p" variant="headingLg">{ideas.length}</Text><Text as="p" tone="subdued">Ready to launch</Text></BlockStack></Card>
          <Card><BlockStack gap="200"><Text as="p" tone="subdued">Primary focus</Text><Text as="p" variant="headingLg">CVR</Text><Text as="p" tone="subdued">Conversion rate</Text></BlockStack></Card>
          <Card><BlockStack gap="200"><Text as="p" tone="subdued">Next review</Text><Text as="p" variant="headingLg">7d</Text><Text as="p" tone="subdued">After sample growth</Text></BlockStack></Card>
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
          {ideas.map(([title, metric, target, lift]) => (
            <Card key={title}>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{title}</Text>
                  <Badge tone="success">{lift}</Badge>
                </InlineStack>
                <InlineStack gap="200">
                  <Badge>{target}</Badge>
                  <Badge>{metric}</Badge>
                </InlineStack>
                <Button url="/app/experiments/new">Build test</Button>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
