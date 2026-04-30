import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { BlockStack, Button, ButtonGroup, Card, FormLayout, Page, Select, TextField } from "@shopify/polaris";
import { z } from "zod";
import { createExperiment } from "../models/experiments.server";
import { requireShopRecord } from "../lib/shop.server";

const Schema = z.object({
  name: z.string().min(3),
  targetType: z.enum(["ALL_PAGES", "TEMPLATE", "PATH_PREFIX", "EXACT_PATH"]),
  targetValue: z.string().optional(),
  trafficSplitA: z.coerce.number().min(1).max(99),
  selectorA: z.string().min(2),
  selectorB: z.string().min(2),
});

export async function action({ request }: ActionFunctionArgs) {
  const shop = await requireShopRecord(request);
  const formData = await request.formData();
  const raw = Object.fromEntries(formData.entries());
  const parsed = Schema.safeParse(raw);

  if (!parsed.success) {
    return json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const experiment = await createExperiment({ shopId: shop.id, ...parsed.data });
  return redirect(`/app/experiments/${experiment.id}`);
}

const TARGET_OPTIONS = [
  { label: "All pages", value: "ALL_PAGES" },
  { label: "Template", value: "TEMPLATE" },
  { label: "Path prefix", value: "PATH_PREFIX" },
  { label: "Exact path", value: "EXACT_PATH" },
];

type ErrorData = { ok: false; errors: { fieldErrors: Record<string, string[]> } };

function fieldError(data: ErrorData | null | undefined, field: string) {
  return data?.errors?.fieldErrors?.[field]?.[0];
}

export default function NewExperimentPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Only targetType needs controlled state — it drives conditional rendering.
  // TextFields use Polaris internal state; no value/onChange avoids SSR hydration mismatch.
  const [targetType, setTargetType] = useState("ALL_PAGES");

  const needsTargetValue = targetType !== "ALL_PAGES";
  const targetValueHelp =
    targetType === "TEMPLATE" ? "e.g. product, collection, index" :
    targetType === "PATH_PREFIX" ? "e.g. /collections/sale" :
    "e.g. /products/my-item";

  const errors = actionData && !actionData.ok ? (actionData as ErrorData) : null;

  return (
    <Page
      title="Create test"
      subtitle="Launch a selector-based A/B test with analytics tracking."
      backAction={{ content: "Tests", url: "/app" }}
    >
      <Card>
        <Form method="post">
          <FormLayout>
            <TextField
              label="Experiment name"
              name="name"
              autoComplete="off"
              placeholder="Homepage hero image test"
              error={fieldError(errors, "name")}
            />
            <Select
              label="Target type"
              name="targetType"
              options={TARGET_OPTIONS}
              value={targetType}
              onChange={setTargetType}
            />
            {needsTargetValue ? (
              <TextField
                label="Target value"
                name="targetValue"
                autoComplete="off"
                helpText={targetValueHelp}
                error={fieldError(errors, "targetValue")}
              />
            ) : null}
            <TextField
              label="Traffic split for Variant A"
              name="trafficSplitA"
              autoComplete="off"
              type="number"
              min={1}
              max={99}
              defaultValue="50"
              suffix="%"
              error={fieldError(errors, "trafficSplitA")}
            />
            <TextField
              label="Original selector / section ID"
              name="selectorA"
              autoComplete="off"
              placeholder="#section-hero-original"
              error={fieldError(errors, "selectorA")}
            />
            <TextField
              label="Variant selector / section ID"
              name="selectorB"
              autoComplete="off"
              placeholder="#section-hero-variant"
              error={fieldError(errors, "selectorB")}
            />
            <ButtonGroup>
              <Button submit variant="primary" loading={isSubmitting}>
                Save experiment
              </Button>
              <Button url="/app">Cancel</Button>
            </ButtonGroup>
          </FormLayout>
        </Form>
      </Card>
    </Page>
  );
}
