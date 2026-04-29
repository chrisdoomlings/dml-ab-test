import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { Button, Card, FormLayout, Page, Select, TextField } from "@shopify/polaris";
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

  const experiment = await createExperiment({
    shopId: shop.id,
    ...parsed.data,
  });

  return redirect(`/app/experiments/${experiment.id}`);
}

export default function NewExperimentPage() {
  const actionData = useActionData<typeof action>();

  return (
    <Page title="Create experiment">
      <Card>
        <div style={{ padding: 16 }}>
          <Form method="post">
            <FormLayout>
              <TextField label="Experiment name" name="name" autoComplete="off" />
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
                label="Target value (optional)"
                name="targetValue"
                autoComplete="off"
                helpText="Example: product, /collections/sale, /products/my-item"
              />
              <TextField
                label="Traffic split for Variant A (%)"
                name="trafficSplitA"
                autoComplete="off"
                type="number"
                min={1}
                max={99}
              />
              <TextField label="Variant A selector / section ID" name="selectorA" autoComplete="off" />
              <TextField label="Variant B selector / section ID" name="selectorB" autoComplete="off" />
              <Button submit variant="primary">
                Save experiment
              </Button>
            </FormLayout>
          </Form>
          {actionData && !actionData.ok ? (
            <p style={{ color: "red", marginTop: 12 }}>Please fix validation errors and retry.</p>
          ) : null}
        </div>
      </Card>
    </Page>
  );
}
