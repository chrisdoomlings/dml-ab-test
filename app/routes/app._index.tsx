import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Badge, Card, Page, Text } from "@shopify/polaris";
import { listExperiments } from "../models/experiments.server";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const experiments = await listExperiments(shop.id);
  return json({ experiments });
}

export default function AppIndex() {
  const { experiments } = useLoaderData<typeof loader>();

  return (
    <Page
      title="A/B Testing"
      primaryAction={{ content: "Create experiment", url: "/app/experiments/new" }}
    >
      <Card>
        <div style={{ padding: 16 }}>
          {experiments.length === 0 ? (
            <Text as="p" variant="bodyMd">
              No experiments yet. Create your first test.
            </Text>
          ) : (
            experiments.map((experiment) => (
              <div key={experiment.id} style={{ marginBottom: 12 }}>
                <Link to={`/app/experiments/${experiment.id}`}>{experiment.name}</Link>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <Badge>{experiment.status}</Badge>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Split A {experiment.trafficSplitA}% / B {100 - experiment.trafficSplitA}%
                  </Text>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </Page>
  );
}
