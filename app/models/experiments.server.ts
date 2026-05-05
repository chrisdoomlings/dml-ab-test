import { AudienceRule, AssignmentMode, ExperimentStatus, type Prisma, type VariantKey } from "@prisma/client";
import { prisma } from "../lib/db.server";

export function listExperiments(shopId: string) {
  return prisma.experiment.findMany({
    where: { shopId },
    include: { variants: true },
    orderBy: { createdAt: "desc" },
  });
}

export function createExperiment(input: {
  shopId: string;
  name: string;
  targetType: "ALL_PAGES" | "TEMPLATE" | "PATH_PREFIX" | "EXACT_PATH";
  targetValue?: string;
  trafficSplitA: number;
  selectorA: string;
  selectorB: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  status?: ExperimentStatus;
  assignmentMode?: AssignmentMode;
  assignmentTtlDays?: number | null;
  audienceRule?: AudienceRule;
  verificationMode?: boolean;
  verificationSwapSeconds?: number | null;
}) {
  return prisma.experiment.create({
    data: {
      shopId: input.shopId,
      name: input.name,
      targetType: input.targetType,
      targetValue: input.targetValue,
      trafficSplitA: input.trafficSplitA,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      status: input.status ?? ExperimentStatus.DRAFT,
      assignmentMode: input.assignmentMode ?? AssignmentMode.STICKY,
      assignmentTtlDays: input.assignmentTtlDays ?? null,
      audienceRule: input.audienceRule ?? AudienceRule.ALL_VISITORS,
      verificationMode: input.verificationMode ?? false,
      verificationSwapSeconds: input.verificationSwapSeconds ?? null,
      variants: {
        create: [
          { key: "A", selector: input.selectorA },
          { key: "B", selector: input.selectorB },
        ],
      },
    },
    include: { variants: true },
  });
}

export async function updateExperimentStatus(input: {
  id: string;
  shopId: string;
  status: ExperimentStatus;
}) {
  const existing = await prisma.experiment.findFirst({
    where: { id: input.id, shopId: input.shopId },
    select: { startsAt: true },
  });

  return prisma.experiment.updateMany({
    where: { id: input.id, shopId: input.shopId },
    data: {
      status: input.status,
      startsAt: input.status === ExperimentStatus.ACTIVE && !existing?.startsAt ? new Date() : undefined,
      endsAt: input.status === ExperimentStatus.STOPPED ? new Date() : undefined,
    },
  });
}

export async function updateExperiment(input: {
  id: string;
  shopId: string;
  name: string;
  targetType: "ALL_PAGES" | "TEMPLATE" | "PATH_PREFIX" | "EXACT_PATH";
  targetValue?: string;
  trafficSplitA: number;
  selectorA: string;
  selectorB: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  assignmentMode?: AssignmentMode;
  assignmentTtlDays?: number | null;
  audienceRule?: AudienceRule;
  verificationMode?: boolean;
  verificationSwapSeconds?: number | null;
}) {
  const exists = await prisma.experiment.findFirst({
    where: { id: input.id, shopId: input.shopId },
    select: { id: true },
  });
  if (!exists) throw new Response("Not found", { status: 404 });

  await prisma.$transaction([
    prisma.experiment.update({
      where: { id: input.id },
      data: {
        name: input.name,
        targetType: input.targetType,
        targetValue: input.targetValue ?? null,
        trafficSplitA: input.trafficSplitA,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        assignmentMode: input.assignmentMode,
        assignmentTtlDays: input.assignmentTtlDays ?? null,
        audienceRule: input.audienceRule,
        verificationMode: input.verificationMode ?? false,
        verificationSwapSeconds: input.verificationSwapSeconds ?? null,
      },
    }),
    prisma.variant.updateMany({
      where: { experimentId: input.id, key: "A" },
      data: { selector: input.selectorA },
    }),
    prisma.variant.updateMany({
      where: { experimentId: input.id, key: "B" },
      data: { selector: input.selectorB },
    }),
  ]);
}

export function deleteExperiment(input: { id: string; shopId: string }) {
  return prisma.experiment.deleteMany({
    where: { id: input.id, shopId: input.shopId },
  });
}

export async function getActiveExperimentsForPath(shopId: string, path: string, template?: string, isReturning?: boolean) {
  const now = new Date();
  const active = await prisma.experiment.findMany({
    where: {
      shopId,
      status: ExperimentStatus.ACTIVE,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        {
          OR: [
            { audienceRule: AudienceRule.ALL_VISITORS },
            ...(isReturning === true ? [{ audienceRule: AudienceRule.RETURNING_VISITORS }] : []),
            ...(isReturning === false ? [{ audienceRule: AudienceRule.NEW_VISITORS }] : []),
          ],
        },
      ],
      OR: [
        { targetType: "ALL_PAGES" },
        { targetType: "EXACT_PATH", targetValue: path },
        { targetType: "PATH_PREFIX", targetValue: { not: null } },
        { targetType: "TEMPLATE", targetValue: template ?? "__none__" },
      ],
    },
    include: { variants: true },
  });

  return active.filter((e) => {
    if (e.targetType === "PATH_PREFIX" && e.targetValue) return path.startsWith(e.targetValue);
    return true;
  });
}

export async function assignVariant(input: {
  experimentId: string;
  visitorId: string;
  splitA: number;
  assignmentMode: AssignmentMode;
  assignmentTtlDays?: number | null;
  sessionId?: string;
}): Promise<VariantKey> {
  const existing = await prisma.visitorAssignment.findUnique({
    where: { experimentId_visitorId: { experimentId: input.experimentId, visitorId: input.visitorId } },
  });

  if (existing) {
    const assignedAtMs = new Date(existing.updatedAt).getTime();
    const ttlDays = input.assignmentTtlDays ?? null;
    const ttlExpired = ttlDays && ttlDays > 0
      ? Date.now() - assignedAtMs > ttlDays * 24 * 60 * 60 * 1000
      : false;
    const sessionMismatch =
      input.assignmentMode === AssignmentMode.SESSION &&
      Boolean(input.sessionId) &&
      existing.sessionId !== input.sessionId;

    if (!ttlExpired && !sessionMismatch) {
      return existing.variantKey;
    }
  }

  const roll = Math.random() * 100;
  const variantKey: VariantKey = roll < input.splitA ? "A" : "B";

  try {
    await prisma.visitorAssignment.upsert({
      where: { experimentId_visitorId: { experimentId: input.experimentId, visitorId: input.visitorId } },
      update: { variantKey, sessionId: input.sessionId ?? null },
      create: {
        experimentId: input.experimentId,
        visitorId: input.visitorId,
        variantKey,
        sessionId: input.sessionId ?? null,
      },
    });
  } catch {
    const concurrent = await prisma.visitorAssignment.findUnique({
      where: { experimentId_visitorId: { experimentId: input.experimentId, visitorId: input.visitorId } },
    });
    if (concurrent) return concurrent.variantKey;
    throw new Error("Unable to assign experiment variant");
  }

  return variantKey;
}

export function trackEvent(input: Prisma.EventUncheckedCreateInput) {
  return prisma.event.create({ data: input });
}

export async function getExperimentSummary(experimentId: string) {
  const [assignments, events, attributions] = await Promise.all([
    prisma.visitorAssignment.groupBy({
      by: ["variantKey"],
      where: { experimentId },
      _count: { _all: true },
    }),
    prisma.event.groupBy({
      by: ["variantKey", "eventType"],
      where: { experimentId },
      _count: { _all: true },
      _sum: { eventValue: true },
    }),
    prisma.orderAttribution.groupBy({
      by: ["variantKey"],
      where: { experimentId },
      _count: { _all: true },
      _sum: { revenue: true },
    }),
  ]);

  return { assignments, events, attributions };
}

// Simulated conversion funnel rates per variant.
// B is intentionally better so the stats dashboard shows a realistic lift.
const SIM = {
  A: { ctr: 0.30, atc: 0.18, cvr: 0.10 },
  B: { ctr: 0.48, atc: 0.30, cvr: 0.20 },
} as const;

export async function simulateTraffic(experimentId: string, shopId: string, count = 50) {
  const experiment = await prisma.experiment.findFirst({
    where: { id: experimentId, shopId },
    select: { trafficSplitA: true },
  });
  if (!experiment) throw new Response("Not found", { status: 404 });

  const now = Date.now();
  const assignments: Prisma.VisitorAssignmentCreateManyInput[] = [];
  const events: Prisma.EventUncheckedCreateInput[] = [];
  const attributions: Prisma.OrderAttributionUncheckedCreateInput[] = [];

  for (let i = 0; i < count; i++) {
    const variantKey: VariantKey =
      Math.random() * 100 < experiment.trafficSplitA ? "A" : "B";
    const visitorId = `sim_${now}_${i}_${Math.random().toString(36).slice(2, 8)}`;
    const rates = SIM[variantKey];

    assignments.push({ experimentId, visitorId, variantKey });
    events.push({ experimentId, visitorId, variantKey, eventType: "IMPRESSION", metadata: { simulated: true } });

    if (Math.random() < rates.ctr) {
      events.push({ experimentId, visitorId, variantKey, eventType: "CLICK", metadata: { simulated: true } });
    }
    if (Math.random() < rates.atc) {
      events.push({ experimentId, visitorId, variantKey, eventType: "ADD_TO_CART", metadata: { simulated: true } });
    }
    if (Math.random() < rates.cvr) {
      const revenue = Math.round((40 + Math.random() * 120) * 100) / 100;
      const orderId = `sim_ord_${now}_${i}`;
      events.push({
        experimentId, visitorId, variantKey,
        eventType: "PURCHASE", eventValue: revenue, currency: "USD", orderId,
        metadata: { simulated: true },
      });
      attributions.push({ experimentId, visitorId, variantKey, orderId, revenue, currency: "USD" });
    }
  }

  await prisma.visitorAssignment.createMany({ data: assignments, skipDuplicates: true });
  // Events don't have a unique constraint so insert sequentially to avoid bulk failures
  for (const event of events) {
    await prisma.event.create({ data: event });
  }
  if (attributions.length) {
    await prisma.orderAttribution.createMany({ data: attributions, skipDuplicates: true });
  }
}

export async function clearExperimentData(experimentId: string, shopId: string) {
  const experiment = await prisma.experiment.findFirst({
    where: { id: experimentId, shopId },
    select: { id: true },
  });
  if (!experiment) throw new Response("Not found", { status: 404 });

  await prisma.$transaction([
    prisma.event.deleteMany({ where: { experimentId } }),
    prisma.orderAttribution.deleteMany({ where: { experimentId } }),
    prisma.visitorAssignment.deleteMany({ where: { experimentId } }),
  ]);
}
