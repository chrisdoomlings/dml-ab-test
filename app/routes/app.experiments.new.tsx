import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
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
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="form-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">New test</div>
          <h1 className="page-title">Create an experiment</h1>
          <p className="page-subtitle">Launch a page, template, or selector-based split test with analytics tracking.</p>
        </div>
      </div>

      <Form method="post" className="form-card">
        <div className="settings-grid">
          <label>
            <div className="metric-label">Experiment name</div>
            <input className="field-input" name="name" autoComplete="off" placeholder="Homepage hero image test" />
          </label>
          <label>
            <div className="metric-label">Traffic split for Variant A</div>
            <input className="field-input" name="trafficSplitA" type="number" min={1} max={99} defaultValue={50} />
          </label>
          <label>
            <div className="metric-label">Target type</div>
            <select className="field-input" name="targetType" defaultValue="ALL_PAGES">
              <option value="ALL_PAGES">All pages</option>
              <option value="TEMPLATE">Template</option>
              <option value="PATH_PREFIX">Path prefix</option>
              <option value="EXACT_PATH">Exact path</option>
            </select>
          </label>
          <label>
            <div className="metric-label">Target value</div>
            <input className="field-input" name="targetValue" autoComplete="off" placeholder="product, /collections/sale, /products/item" />
          </label>
          <label>
            <div className="metric-label">Original selector</div>
            <input className="field-input" name="selectorA" autoComplete="off" placeholder="#section-hero-original" />
          </label>
          <label>
            <div className="metric-label">Variant selector</div>
            <input className="field-input" name="selectorB" autoComplete="off" placeholder="#section-hero-variant" />
          </label>
        </div>

        {actionData && !actionData.ok ? (
          <p className="page-subtitle" style={{ color: "#a92045" }}>
            Please fix validation errors and retry.
          </p>
        ) : null}

        <div className="button-row" style={{ marginTop: 22 }}>
          <button className="button-primary" type="submit" disabled={isSubmitting}>
            Save experiment
          </button>
          <a className="button-secondary" href="/app">
            Cancel
          </a>
        </div>
      </Form>
    </div>
  );
}
