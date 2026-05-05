import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, FormLayout, Page, Select, Text, TextField } from "@shopify/polaris";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { requireShopRecord } from "../lib/shop.server";
import { prisma } from "../lib/db.server";

const SettingsSchema = z.object({
  defaultTrafficSplit: z.coerce.number().int().min(1).max(99),
  defaultAssignmentMode: z.enum(["STICKY", "SESSION"]),
  certaintyThreshold: z.coerce.number().int().min(70).max(99),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await requireShopRecord(request);
  const hasOrdersScope = session.scope?.split(",").map((s) => s.trim()).includes("read_orders") ?? false;
  return json({ shop, hasOrdersScope });
}

export async function action({ request }: ActionFunctionArgs) {
  const shop = await requireShopRecord(request);
  const formData = await request.formData();
  const raw = Object.fromEntries(formData.entries());
  const parsed = SettingsSchema.safeParse(raw);

  if (!parsed.success) {
    return json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      defaultTrafficSplit: parsed.data.defaultTrafficSplit,
      defaultAssignmentMode: parsed.data.defaultAssignmentMode,
      certaintyThreshold: parsed.data.certaintyThreshold,
    },
  });

  return redirect("/app/settings?saved=1");
}

const ASSIGNMENT_OPTIONS = [
  { label: "Sticky — same variant every visit (recommended)", value: "STICKY" },
  { label: "Per session — re-assign each browser session", value: "SESSION" },
];

const CERTAINTY_OPTIONS = [
  { label: "70% — fast decisions, higher risk of false positives", value: "70" },
  { label: "80% — balanced", value: "80" },
  { label: "85% — default", value: "85" },
  { label: "90% — conservative", value: "90" },
  { label: "95% — scientific standard", value: "95" },
];

type ErrorData = { ok: false; errors: { fieldErrors: Record<string, string[]> } };

function fieldError(data: ErrorData | null | undefined, field: string) {
  return data?.errors?.fieldErrors?.[field]?.[0];
}

export default function SettingsPage() {
  const { shop, hasOrdersScope } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const saved = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("saved") === "1";

  const errors = actionData && !actionData.ok ? (actionData as ErrorData) : null;

  return (
    <Page title="Settings" subtitle="Configure default values and statistical preferences for this store.">
      <BlockStack gap="400">

        {saved && (
          <Banner tone="success" title="Settings saved" />
        )}

        <Card>
          <Form method="post">
            <FormLayout>
              <Text as="h2" variant="headingMd">Experiment defaults</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                These values pre-fill the "Create test" form. You can override them per experiment.
              </Text>

              <TextField
                label="Default traffic split for Variant A"
                name="defaultTrafficSplit"
                type="number"
                min={1}
                max={99}
                suffix="%"
                autoComplete="off"
                defaultValue={String(shop.defaultTrafficSplit)}
                helpText="Variant B gets the remainder. 50 means an even split."
                error={fieldError(errors, "defaultTrafficSplit")}
              />

              <Select
                label="Default assignment mode"
                name="defaultAssignmentMode"
                options={ASSIGNMENT_OPTIONS}
                defaultValue={shop.defaultAssignmentMode}
              />

              <Select
                label="Certainty threshold"
                name="certaintyThreshold"
                options={CERTAINTY_OPTIONS}
                defaultValue={String(shop.certaintyThreshold)}
                helpText='The "Probability to win" badge turns green when this threshold is reached.'
              />

              <Button submit variant="primary" loading={isSubmitting}>
                Save settings
              </Button>
            </FormLayout>
          </Form>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Revenue attribution</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {hasOrdersScope
                ? "The read_orders scope is granted. Order revenue is attributed to experiments via webhook."
                : "Revenue tracking requires the read_orders scope. Submit a protected customer data request through the Shopify Partner Dashboard to enable it. All other metrics (CVR, CTR, ATC) work without this."}
            </Text>
            <Text as="p" variant="bodySm">
              Status: <Text as="span" fontWeight="semibold">{hasOrdersScope ? "Enabled" : "Approval needed"}</Text>
              {" · "}
              Shop: <Text as="span" fontWeight="semibold">{shop.shopDomain}</Text>
            </Text>
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}
