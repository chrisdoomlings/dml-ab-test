import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Card, Page, Text } from "@shopify/polaris";
import { listExperiments } from "../models/experiments.server";

// Replace with real auth from shopify-app-remix in production.
async function getSingleShopId() {
  const shopId = process.env.SINGLE_SHOP_ID;
  if (!shopId) throw new Error("Set SINGLE_SHOP_ID in env for local starter");
  return shopId;
}

export async function loader({ request }: LoaderFunctionArgs) {
  void request;
  const shopId = await getSingleShopId();
  const experiments = await listExperiments(shopId);
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
                <Text as="p" variant="bodySm" tone="subdued">
                  {experiment.status} • Split A {experiment.trafficSplitA}% / B{" "}
                  {100 - experiment.trafficSplitA}%
                </Text>
              </div>
            ))
          )}
        </div>
      </Card>
    </Page>
  );
}
