import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Card, InlineGrid, InlineStack, List, Page, Text } from "@shopify/polaris";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  return json({ shop });
}

export default function SettingsPage() {
  const { shop } = useLoaderData<typeof loader>();

  return (
    <Page title="Settings" subtitle="Measurement setup, attribution status, and data controls for this store.">
      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between"><Text as="h2" variant="headingMd">Store connection</Text><Badge tone="success">Connected</Badge></InlineStack>
            <List>
              <List.Item>Shop domain: {shop.shopDomain}</List.Item>
              <List.Item>Theme app extension: enabled in theme editor</List.Item>
              <List.Item>Assignment storage: localStorage</List.Item>
              <List.Item>Fail-open behavior: Variant A visible</List.Item>
            </List>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between"><Text as="h2" variant="headingMd">Revenue attribution</Text><Badge tone="warning">Approval needed</Badge></InlineStack>
            <List>
              <List.Item>Order webhook: disabled</List.Item>
              <List.Item>Required scope: read_orders</List.Item>
              <List.Item>Protected customer data review required by Shopify</List.Item>
              <List.Item>Revenue cards are ready after approval</List.Item>
            </List>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between"><Text as="h2" variant="headingMd">Analytics goals</Text><Badge tone="success">Active</Badge></InlineStack>
            <List>
              <List.Item>Primary goal: conversion rate</List.Item>
              <List.Item>Secondary goal: add-to-cart rate</List.Item>
              <List.Item>Reporting metrics: CVR, CTR, ATC, RPV, AOV</List.Item>
              <List.Item>Certainty threshold: 85%</List.Item>
            </List>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between"><Text as="h2" variant="headingMd">Data quality</Text><Badge tone="success">Healthy</Badge></InlineStack>
            <List>
              <List.Item>Assignment rule: one visitor per test</List.Item>
              <List.Item>Public API: CORS enabled</List.Item>
              <List.Item>Webhook auth: implemented</List.Item>
              <List.Item>Migration status: manual SQL included</List.Item>
            </List>
          </BlockStack>
        </Card>
      </InlineGrid>
    </Page>
  );
}
