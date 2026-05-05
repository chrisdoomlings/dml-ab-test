import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  FormLayout,
  Page,
  Select,
  TextField,
} from "@shopify/polaris";
import { z } from "zod";
import { prisma } from "../lib/db.server";
import { requireShopRecord } from "../lib/shop.server";
import { updateExperiment } from "../models/experiments.server";

const ASSIGNMENT_MODE = { STICKY: "STICKY", SESSION: "SESSION" } as const;
const AUDIENCE_RULE = {
  ALL_VISITORS: "ALL_VISITORS",
  NEW_VISITORS: "NEW_VISITORS",
  RETURNING_VISITORS: "RETURNING_VISITORS",
} as const;

const Schema = z
  .object({
    name: z.string().min(3),
    targetType: z.enum(["ALL_PAGES", "TEMPLATE", "PATH_PREFIX", "EXACT_PATH"]),
    targetValue: z.string().optional(),
    trafficSplitA: z.coerce.number().min(1).max(99),
    selectorA: z.string().min(2),
    selectorB: z.string().min(2),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    assignmentMode: z
      .enum([ASSIGNMENT_MODE.STICKY, ASSIGNMENT_MODE.SESSION])
      .default(ASSIGNMENT_MODE.STICKY),
    assignmentTtlDays: z
      .union([z.literal(""), z.coerce.number().int().min(1).max(365)])
      .optional(),
    audienceRule: z
      .enum([AUDIENCE_RULE.ALL_VISITORS, AUDIENCE_RULE.NEW_VISITORS, AUDIENCE_RULE.RETURNING_VISITORS])
      .default(AUDIENCE_RULE.ALL_VISITORS),
    verificationMode: z
      .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal(""), z.undefined()])
      .optional(),
    verificationSwapSeconds: z
      .union([z.literal(""), z.coerce.number().int().min(1).max(120)])
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.endsAt && !data.startsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "Set a start time when an end time is provided." });
    }
    if (data.startsAt && data.endsAt) {
      const start = new Date(data.startsAt);
      const end = new Date(data.endsAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "End time must be later than start time." });
      }
    }
    if (data.assignmentMode === ASSIGNMENT_MODE.SESSION && data.assignmentTtlDays && data.assignmentTtlDays !== "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assignmentTtlDays"], message: "TTL is only used for sticky assignment mode." });
    }
    const verificationMode = data.verificationMode === "on" || data.verificationMode === "true";
    if (verificationMode && (!data.verificationSwapSeconds || data.verificationSwapSeconds === "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["verificationSwapSeconds"], message: "Set swap interval in seconds for verification mode." });
    }
  });

function parseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDatetimeLocal(value: Date | string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const experiment = await prisma.experiment.findFirst({
    where: { id, shopId: shop.id },
    include: { variants: true },
  });
  if (!experiment) throw new Response("Not found", { status: 404 });

  return json({ experiment });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const shop = await requireShopRecord(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const raw = Object.fromEntries(formData.entries());
  const parsed = Schema.safeParse(raw);

  if (!parsed.success) {
    return json({ ok: false, errors: parsed.error.flatten() }, { status: 400 });
  }

  await updateExperiment({
    id,
    shopId: shop.id,
    ...parsed.data,
    startsAt: parseDate(parsed.data.startsAt),
    endsAt: parseDate(parsed.data.endsAt),
    assignmentTtlDays:
      parsed.data.assignmentTtlDays === "" || parsed.data.assignmentTtlDays == null
        ? null
        : parsed.data.assignmentTtlDays,
    verificationMode: parsed.data.verificationMode === "on" || parsed.data.verificationMode === "true",
    verificationSwapSeconds:
      parsed.data.verificationSwapSeconds === "" || parsed.data.verificationSwapSeconds == null
        ? null
        : parsed.data.verificationSwapSeconds,
  });

  return redirect(`/app/experiments/${id}`);
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

export default function EditExperimentPage() {
  const { experiment } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const isLive = experiment.status === "ACTIVE";

  const selectorA = experiment.variants.find((v) => v.key === "A")?.selector ?? "";
  const selectorB = experiment.variants.find((v) => v.key === "B")?.selector ?? "";

  const [formValues, setFormValues] = useState({
    name: experiment.name,
    targetType: experiment.targetType,
    targetValue: experiment.targetValue ?? "",
    trafficSplitA: String(experiment.trafficSplitA),
    selectorA,
    selectorB,
    startsAt: toDatetimeLocal(experiment.startsAt),
    endsAt: toDatetimeLocal(experiment.endsAt),
    assignmentMode: experiment.assignmentMode,
    assignmentTtlDays: experiment.assignmentTtlDays != null ? String(experiment.assignmentTtlDays) : "",
    audienceRule: experiment.audienceRule,
    verificationMode: experiment.verificationMode,
    verificationSwapSeconds: experiment.verificationSwapSeconds != null
      ? String(experiment.verificationSwapSeconds)
      : "5",
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
      title="Edit experiment"
      subtitle={experiment.name}
      backAction={{ content: "Back", url: `/app/experiments/${experiment.id}` }}
    >
      <BlockStack gap="400">
        {isLive && (
          <Banner tone="warning">
            This experiment is currently live. Editing selectors or traffic split will take effect
            immediately and may affect visitors already in the test.
          </Banner>
        )}

        <Card>
          <Form method="post">
            <FormLayout>
              <TextField
                label="Experiment name"
                name="name"
                value={formValues.name}
                onChange={setField("name")}
                autoComplete="off"
                error={fieldError(errors, "name")}
              />
              <Select
                label="Target type"
                name="targetType"
                options={TARGET_OPTIONS}
                value={formValues.targetType}
                onChange={setField("targetType")}
              />
              {needsTargetValue && (
                <TextField
                  label="Target value"
                  name="targetValue"
                  value={formValues.targetValue}
                  onChange={setField("targetValue")}
                  autoComplete="off"
                  helpText={targetValueHelp}
                  error={fieldError(errors, "targetValue")}
                />
              )}
              <TextField
                label="Traffic split for Variant A"
                name="trafficSplitA"
                value={formValues.trafficSplitA}
                onChange={setField("trafficSplitA")}
                autoComplete="off"
                type="number"
                min={1}
                max={99}
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
                helpText="Open browser DevTools → inspect the section → copy its id attribute with # prefix"
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
              {formValues.assignmentMode === ASSIGNMENT_MODE.STICKY && (
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
              )}
              <Select
                label="Audience rule"
                name="audienceRule"
                options={AUDIENCE_RULE_OPTIONS}
                value={formValues.audienceRule}
                onChange={setField("audienceRule")}
              />
              <Checkbox
                label="Verification mode (auto swap A/B for QA)"
                name="verificationMode"
                checked={formValues.verificationMode}
                onChange={(checked) =>
                  setFormValues((prev) => ({ ...prev, verificationMode: checked }))
                }
                helpText="Use only for testing instrumentation and UI behavior."
              />
              {formValues.verificationMode && (
                <TextField
                  label="Swap every N seconds"
                  name="verificationSwapSeconds"
                  value={formValues.verificationSwapSeconds}
                  onChange={setField("verificationSwapSeconds")}
                  type="number"
                  autoComplete="off"
                  min={1}
                  max={120}
                  error={fieldError(errors, "verificationSwapSeconds")}
                />
              )}
              <ButtonGroup>
                <Button submit variant="primary" loading={isSubmitting}>
                  Save changes
                </Button>
                <Button url={`/app/experiments/${experiment.id}`}>Cancel</Button>
              </ButtonGroup>
            </FormLayout>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}
