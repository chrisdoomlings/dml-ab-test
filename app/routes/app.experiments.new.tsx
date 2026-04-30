import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { Banner, BlockStack, Button, ButtonGroup, Card, FormLayout, Page, Select, TextField } from "@shopify/polaris";
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

export default function NewExperimentPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <Page title="Create test" subtitle="Launch a selector-based A/B test with analytics tracking." backAction={{ content: "Tests", url: "/app" }}>
      <Card>
        <BlockStack gap="400">
          {actionData && !actionData.ok ? (
            <Banner tone="critical">Please fix validation errors and retry.</Banner>
          ) : null}
          <Form method="post">
            <FormLayout>
              <TextField label="Experiment name" name="name" autoComplete="off" placeholder="Homepage hero image test" />
              <Select
                label="Target type"
                name="targetType"
                options={[
                  { label: "All pages", value: "ALL_PAGES" },
                  { label: "Template", value: "TEMPLATE" },
                  { label: "Path prefix", value: "PATH_PREFIX" },
                  { label: "Exact path", value: "EXACT_PATH" },
                ]}
              />
              <TextField
                label="Target value"
                name="targetValue"
                autoComplete="off"
                helpText="Example: product, /collections/sale, /products/my-item"
              />
              <TextField
                label="Traffic split for Variant A"
                name="trafficSplitA"
                autoComplete="off"
                type="number"
                min={1}
                max={99}
                defaultValue="50"
                suffix="%"
              />
              <TextField label="Original selector / section ID" name="selectorA" autoComplete="off" placeholder="#section-hero-original" />
              <TextField label="Variant selector / section ID" name="selectorB" autoComplete="off" placeholder="#section-hero-variant" />
              <ButtonGroup>
                <Button submit variant="primary" loading={isSubmitting}>
                  Save experiment
                </Button>
                <Button url="/app">Cancel</Button>
              </ButtonGroup>
            </FormLayout>
          </Form>
        </BlockStack>
      </Card>
    </Page>
  );
}
