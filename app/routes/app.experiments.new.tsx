import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { BlockStack, Button, ButtonGroup, Card, FormLayout, Page, Select, TextField } from "@shopify/polaris";
import { z } from "zod";
import { createExperiment } from "../models/experiments.server";
import { requireShopRecord } from "../lib/shop.server";

const ASSIGNMENT_MODE = {
  STICKY: "STICKY",
  SESSION: "SESSION",
} as const;

const AUDIENCE_RULE = {
  ALL_VISITORS: "ALL_VISITORS",
  NEW_VISITORS: "NEW_VISITORS",
  RETURNING_VISITORS: "RETURNING_VISITORS",
} as const;

const Schema = z.object({
  name: z.string().min(3),
  targetType: z.enum(["ALL_PAGES", "TEMPLATE", "PATH_PREFIX", "EXACT_PATH"]),
  targetValue: z.string().optional(),
  trafficSplitA: z.coerce.number().min(1).max(99),
  selectorA: z.string().min(2),
  selectorB: z.string().min(2),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  assignmentMode: z.enum([ASSIGNMENT_MODE.STICKY, ASSIGNMENT_MODE.SESSION]).default(ASSIGNMENT_MODE.STICKY),
  assignmentTtlDays: z.union([z.literal(""), z.coerce.number().int().min(1).max(365)]).optional(),
  audienceRule: z
    .enum([AUDIENCE_RULE.ALL_VISITORS, AUDIENCE_RULE.NEW_VISITORS, AUDIENCE_RULE.RETURNING_VISITORS])
    .default(AUDIENCE_RULE.ALL_VISITORS),
}).superRefine((data, ctx) => {
  if (data.endsAt && !data.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "Set a start time when an end time is provided.",
    });
  }

  if (data.startsAt && data.endsAt) {
    const start = new Date(data.startsAt);
    const end = new Date(data.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End time must be later than start time.",
      });
    }
  }

  if (data.assignmentMode === ASSIGNMENT_MODE.SESSION && data.assignmentTtlDays && data.assignmentTtlDays !== "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assignmentTtlDays"],
      message: "TTL is only used for sticky assignment mode.",
    });
  }
});

function parseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function action({ request }: ActionFunctionArgs) {
  const shop = await requireShopRecord(request);
  const formData = await request.formData();
  const raw = Object.fromEntries(formData.entries());
  const parsed = Schema.safeParse(raw);

  if (!parsed.success) {
    return json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  const startsAt = parseDate(parsed.data.startsAt);
  const endsAt = parseDate(parsed.data.endsAt);
  const shouldAutoActivate = Boolean(startsAt || endsAt);

  const experiment = await createExperiment({
    shopId: shop.id,
    ...parsed.data,
    startsAt,
    endsAt,
    status: shouldAutoActivate ? "ACTIVE" : "DRAFT",
    assignmentMode: parsed.data.assignmentMode,
    assignmentTtlDays:
      parsed.data.assignmentTtlDays === "" || parsed.data.assignmentTtlDays == null
        ? null
        : parsed.data.assignmentTtlDays,
    audienceRule: parsed.data.audienceRule,
  });
  return redirect(`/app/experiments/${experiment.id}`);
}

const TARGET_OPTIONS = [
  { label: "All pages", value: "ALL_PAGES" },
  { label: "Template", value: "TEMPLATE" },
  { label: "Path prefix", value: "PATH_PREFIX" },
  { label: "Exact path", value: "EXACT_PATH" },
];
const ASSIGNMENT_MODE_OPTIONS = [
  { label: "Sticky (recommended)", value: ASSIGNMENT_MODE.STICKY },
  { label: "Per session", value: ASSIGNMENT_MODE.SESSION },
];
const AUDIENCE_RULE_OPTIONS = [
  { label: "All visitors", value: AUDIENCE_RULE.ALL_VISITORS },
  { label: "New visitors only", value: AUDIENCE_RULE.NEW_VISITORS },
  { label: "Returning visitors only", value: AUDIENCE_RULE.RETURNING_VISITORS },
];

type ErrorData = { ok: false; errors: { fieldErrors: Record<string, string[]> } };

function fieldError(data: ErrorData | null | undefined, field: string) {
  return data?.errors?.fieldErrors?.[field]?.[0];
}

export default function NewExperimentPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [formValues, setFormValues] = useState({
    name: "",
    targetType: "ALL_PAGES",
    targetValue: "",
    trafficSplitA: "50",
    selectorA: "",
    selectorB: "",
    startsAt: "",
    endsAt: "",
    assignmentMode: ASSIGNMENT_MODE.STICKY,
    assignmentTtlDays: "",
    audienceRule: AUDIENCE_RULE.ALL_VISITORS,
  });
  const setField =
    (field: keyof typeof formValues) =>
    (value: string) =>
      setFormValues((prev) => ({ ...prev, [field]: value }));

  const needsTargetValue = formValues.targetType !== "ALL_PAGES";
  const targetValueHelp =
    formValues.targetType === "TEMPLATE" ? "e.g. product, collection, index" :
    formValues.targetType === "PATH_PREFIX" ? "e.g. /collections/sale" :
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
              value={formValues.name}
              onChange={setField("name")}
              autoComplete="off"
              placeholder="Homepage hero image test"
              error={fieldError(errors, "name")}
            />
            <Select
              label="Target type"
              name="targetType"
              options={TARGET_OPTIONS}
              value={formValues.targetType}
              onChange={setField("targetType")}
            />
            {needsTargetValue ? (
              <TextField
                label="Target value"
                name="targetValue"
                value={formValues.targetValue}
                onChange={setField("targetValue")}
                autoComplete="off"
                helpText={targetValueHelp}
                error={fieldError(errors, "targetValue")}
              />
            ) : null}
            <TextField
              label="Traffic split for Variant A"
              name="trafficSplitA"
              value={formValues.trafficSplitA}
              onChange={setField("trafficSplitA")}
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
              value={formValues.selectorA}
              onChange={setField("selectorA")}
              autoComplete="off"
              placeholder="#section-hero-original"
              error={fieldError(errors, "selectorA")}
            />
            <TextField
              label="Variant selector / section ID"
              name="selectorB"
              value={formValues.selectorB}
              onChange={setField("selectorB")}
              autoComplete="off"
              placeholder="#section-hero-variant"
              error={fieldError(errors, "selectorB")}
            />
            <TextField
              label="Start at (optional)"
              name="startsAt"
              value={formValues.startsAt}
              onChange={setField("startsAt")}
              type="datetime-local"
              autoComplete="off"
              helpText="If set, this test auto-activates and starts at this time."
              error={fieldError(errors, "startsAt")}
            />
            <TextField
              label="End at (optional)"
              name="endsAt"
              value={formValues.endsAt}
              onChange={setField("endsAt")}
              type="datetime-local"
              autoComplete="off"
              helpText="Optional stop time. Must be after start."
              error={fieldError(errors, "endsAt")}
            />
            <Select
              label="Assignment frequency"
              name="assignmentMode"
              options={ASSIGNMENT_MODE_OPTIONS}
              value={formValues.assignmentMode}
              onChange={setField("assignmentMode")}
            />
            {formValues.assignmentMode === ASSIGNMENT_MODE.STICKY ? (
              <TextField
                label="Re-randomize after N days (optional)"
                name="assignmentTtlDays"
                value={formValues.assignmentTtlDays}
                onChange={setField("assignmentTtlDays")}
                type="number"
                autoComplete="off"
                min={1}
                max={365}
                helpText="Leave blank to keep the same assignment forever."
                error={fieldError(errors, "assignmentTtlDays")}
              />
            ) : null}
            <Select
              label="Audience rule"
              name="audienceRule"
              options={AUDIENCE_RULE_OPTIONS}
              value={formValues.audienceRule}
              onChange={setField("audienceRule")}
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
