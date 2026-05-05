import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Card, InlineGrid, InlineStack, List, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { requireShopRecord } from "../lib/shop.server";
import { prisma } from "../lib/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await requireShopRecord(request);

  const hasOrdersScope = session.scope?.split(",").map((s) => s.trim()).includes("read_orders") ?? false;

  const [totalExperiments, activeExperiments, totalVisitors] = await Promise.all([
    prisma.experiment.count({ where: { shopId: shop.id } }),
    prisma.experiment.count({ where: { shopId: shop.id, status: "ACTIVE" } }),
    prisma.visitorAssignment.count({
      where: { experiment: { shopId: shop.id } },
    }),
  ]);

  return json({ shop, hasOrdersScope, totalExperiments, activeExperiments, totalVisitors });
}

export default function SettingsPage() {
  const { shop, hasOrdersScope, totalExperiments, activeExperiments, totalVisitors } = useLoaderData<typeof loader>();

  return (
    <Page title="Settings" subtitle="Measurement setup, attribution status, and data controls for this store.">
      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Store connection</Text>
              <Badge tone="success">Connected</Badge>
            </InlineStack>
            <List>
              <List.Item>Shop domain: {shop.shopDomain}</List.Item>
              <List.Item>Assignment storage: localStorage + cookie backup</List.Item>
              <List.Item>Anti-flicker: synchronous CSS injection before page renders</List.Item>
              <List.Item>Fail-open behavior: Original (A) shown on error</List.Item>
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Revenue attribution</Text>
              <Badge tone={hasOrdersScope ? "success" : "warning"}>
                {hasOrdersScope ? "Enabled" : "Approval needed"}
              </Badge>
            </InlineStack>
            <List>
              {hasOrdersScope ? (
                <>
                  <List.Item>Order scope: read_orders granted</List.Item>
                  <List.Item>Revenue is tracked per experiment via order webhook</List.Item>
                  <List.Item>RPV and AOV metrics are live</List.Item>
                </>
              ) : (
                <>
                  <List.Item>Required scope: read_orders (not yet granted)</List.Item>
                  <List.Item>Shopify protected customer data review required</List.Item>
                  <List.Item>Revenue cards will populate after approval</List.Item>
                  <List.Item>All other metrics (CVR, CTR, ATC) work without this</List.Item>
                </>
              )}
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Analytics goals</Text>
              <Badge tone="success">Active</Badge>
            </InlineStack>
            <List>
              <List.Item>Primary goal: conversion rate (CVR)</List.Item>
              <List.Item>Secondary goals: CTR, add-to-cart rate</List.Item>
              <List.Item>Revenue metrics: RPV, AOV (requires read_orders)</List.Item>
              <List.Item>Statistical certainty threshold: 85%</List.Item>
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Store stats</Text>
              <Badge tone="success">Live</Badge>
            </InlineStack>
            <List>
              <List.Item>Total experiments: {totalExperiments}</List.Item>
              <List.Item>Currently active: {activeExperiments}</List.Item>
              <List.Item>Total visitor assignments: {totalVisitors.toLocaleString()}</List.Item>
              <List.Item>Assignment rule: one variant per visitor per test</List.Item>
            </List>
          </BlockStack>
        </Card>
      </InlineGrid>
    </Page>
  );
}
