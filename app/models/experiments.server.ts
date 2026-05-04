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
