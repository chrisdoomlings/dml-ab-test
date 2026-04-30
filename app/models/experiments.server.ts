import { ExperimentStatus, type Prisma, type VariantKey } from "@prisma/client";
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
}) {
  return prisma.experiment.create({
    data: {
      shopId: input.shopId,
      name: input.name,
      targetType: input.targetType,
      targetValue: input.targetValue,
      trafficSplitA: input.trafficSplitA,
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

export function updateExperimentStatus(input: {
  id: string;
  shopId: string;
  status: ExperimentStatus;
}) {
  return prisma.experiment.updateMany({
    where: { id: input.id, shopId: input.shopId },
    data: {
      status: input.status,
      startsAt: input.status === ExperimentStatus.ACTIVE ? new Date() : undefined,
      endsAt: input.status === ExperimentStatus.STOPPED ? new Date() : undefined,
    },
  });
}

export function deleteExperiment(input: { id: string; shopId: string }) {
  return prisma.experiment.deleteMany({
    where: { id: input.id, shopId: input.shopId },
  });
}

export async function getActiveExperimentsForPath(shopId: string, path: string, template?: string) {
  const now = new Date();
  const active = await prisma.experiment.findMany({
    where: {
      shopId,
      status: ExperimentStatus.ACTIVE,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
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

export async function assignVariant(experimentId: string, visitorId: string, splitA: number): Promise<VariantKey> {
  const existing = await prisma.visitorAssignment.findUnique({
    where: { experimentId_visitorId: { experimentId, visitorId } },
  });

  if (existing) return existing.variantKey;

  const roll = Math.random() * 100;
  const variantKey: VariantKey = roll < splitA ? "A" : "B";

  try {
    await prisma.visitorAssignment.create({
      data: { experimentId, visitorId, variantKey },
    });
  } catch {
    const concurrent = await prisma.visitorAssignment.findUnique({
      where: { experimentId_visitorId: { experimentId, visitorId } },
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
