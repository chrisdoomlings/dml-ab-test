import type { EventType, Experiment, ExperimentStatus, Variant, VariantKey } from "@prisma/client";
import { getExperimentSummary, listExperiments } from "../models/experiments.server";

type ExperimentWithVariants = Experiment & { variants: Variant[] };
type Summary = Awaited<ReturnType<typeof getExperimentSummary>>;

const EVENT_TYPES: EventType[] = ["IMPRESSION", "CLICK", "ADD_TO_CART", "CHECKOUT_STARTED", "PURCHASE"];

function countByVariant(summary: Summary, variantKey: VariantKey, eventType: EventType) {
  return summary.events.find((event) => event.variantKey === variantKey && event.eventType === eventType)?._count._all ?? 0;
}

function assignmentCount(summary: Summary, variantKey: VariantKey) {
  return summary.assignments.find((assignment) => assignment.variantKey === variantKey)?._count._all ?? 0;
}

function revenueByVariant(summary: Summary, variantKey: VariantKey) {
  return summary.attributions.find((attribution) => attribution.variantKey === variantKey)?._sum.revenue ?? 0;
}

export function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function lift(control: number, variant: number) {
  if (control <= 0 && variant > 0) return 1;
  if (control <= 0) return 0;
  return (variant - control) / control;
}

function certainty(visitorsA: number, visitorsB: number, liftValue: number) {
  const sampleScore = Math.min(1, (visitorsA + visitorsB) / 1000);
  const effectScore = Math.min(1, Math.abs(liftValue) * 8);
  return Math.round((0.5 + sampleScore * 0.28 + effectScore * 0.2) * 100);
}

export function statusLabel(status: ExperimentStatus) {
  if (status === "ACTIVE") return "Live";
  if (status === "STOPPED") return "Ended";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function summarizeExperiment(experiment: ExperimentWithVariants, summary: Summary) {
  const visitorsA = assignmentCount(summary, "A");
  const visitorsB = assignmentCount(summary, "B");
  const visitors = visitorsA + visitorsB;
  const impressionsA = countByVariant(summary, "A", "IMPRESSION");
  const impressionsB = countByVariant(summary, "B", "IMPRESSION");
  const clicksA = countByVariant(summary, "A", "CLICK");
  const clicksB = countByVariant(summary, "B", "CLICK");
  const addsA = countByVariant(summary, "A", "ADD_TO_CART");
  const addsB = countByVariant(summary, "B", "ADD_TO_CART");
  const checkoutsA = countByVariant(summary, "A", "CHECKOUT_STARTED");
  const checkoutsB = countByVariant(summary, "B", "CHECKOUT_STARTED");
  const purchasesA = countByVariant(summary, "A", "PURCHASE");
  const purchasesB = countByVariant(summary, "B", "PURCHASE");
  const revenueA = revenueByVariant(summary, "A");
  const revenueB = revenueByVariant(summary, "B");

  const cvrA = rate(purchasesA, visitorsA);
  const cvrB = rate(purchasesB, visitorsB);
  const ctrA = rate(clicksA, impressionsA);
  const ctrB = rate(clicksB, impressionsB);
  const atcA = rate(addsA, visitorsA);
  const atcB = rate(addsB, visitorsB);
  const rpvA = rate(revenueA, visitorsA);
  const rpvB = rate(revenueB, visitorsB);
  const aovA = rate(revenueA, purchasesA);
  const aovB = rate(revenueB, purchasesB);
  const cvrLift = lift(cvrA, cvrB);
  const rpvLift = lift(rpvA, rpvB);
  const certaintyScore = certainty(visitorsA, visitorsB, cvrLift);
  const winner: VariantKey | "Tie" = cvrA === cvrB ? "Tie" : cvrB > cvrA ? "B" : "A";

  return {
    id: experiment.id,
    name: experiment.name,
    status: experiment.status,
    statusLabel: statusLabel(experiment.status),
    targetType: experiment.targetType,
    targetValue: experiment.targetValue,
    trafficSplitA: experiment.trafficSplitA,
    createdAt: experiment.createdAt,
    startedAt: experiment.startsAt,
    endedAt: experiment.endsAt,
    variants: experiment.variants,
    visitorsA,
    visitorsB,
    visitors,
    impressionsA,
    impressionsB,
    clicksA,
    clicksB,
    addsA,
    addsB,
    checkoutsA,
    checkoutsB,
    purchasesA,
    purchasesB,
    revenueA,
    revenueB,
    cvrA,
    cvrB,
    ctrA,
    ctrB,
    atcA,
    atcB,
    rpvA,
    rpvB,
    aovA,
    aovB,
    cvrLift,
    rpvLift,
    certaintyScore,
    winner,
  };
}

export async function listExperimentAnalytics(shopId: string) {
  const experiments = await listExperiments(shopId);
  return Promise.all(
    experiments.map(async (experiment) => {
      const summary = await getExperimentSummary(experiment.id);
      return summarizeExperiment(experiment, summary);
    }),
  );
}

export function totals(rows: Awaited<ReturnType<typeof listExperimentAnalytics>>) {
  return rows.reduce(
    (acc, row) => {
      acc.tests += 1;
      acc.live += row.status === "ACTIVE" ? 1 : 0;
      acc.visitors += row.visitors;
      acc.revenue += row.revenueA + row.revenueB;
      acc.lift += row.cvrLift;
      return acc;
    },
    { tests: 0, live: 0, visitors: 0, revenue: 0, lift: 0 },
  );
}

export function metricTotals(rows: Awaited<ReturnType<typeof listExperimentAnalytics>>) {
  return rows.reduce(
    (acc, row) => {
      EVENT_TYPES.forEach((eventType) => {
        acc[eventType] += countEvent(row, eventType);
      });
      return acc;
    },
    { IMPRESSION: 0, CLICK: 0, ADD_TO_CART: 0, CHECKOUT_STARTED: 0, PURCHASE: 0 } as Record<EventType, number>,
  );
}

function countEvent(row: ReturnType<typeof summarizeExperiment>, eventType: EventType) {
  if (eventType === "IMPRESSION") return row.impressionsA + row.impressionsB;
  if (eventType === "CLICK") return row.clicksA + row.clicksB;
  if (eventType === "ADD_TO_CART") return row.addsA + row.addsB;
  if (eventType === "CHECKOUT_STARTED") return row.checkoutsA + row.checkoutsB;
  if (eventType === "PURCHASE") return row.purchasesA + row.purchasesB;
  return 0;
}
