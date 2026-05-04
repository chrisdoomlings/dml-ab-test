import type { EventType, Experiment, ExperimentStatus, Variant, VariantKey } from "@prisma/client";
import { prisma } from "./db.server";
import { listExperiments } from "../models/experiments.server";

type ExperimentWithVariants = Experiment & { variants: Variant[] };
type Summary = {
  assignments: Array<{ variantKey: VariantKey; _count: { _all: number } }>;
  events: Array<{ variantKey: VariantKey; eventType: EventType; _count: { _all: number } }>;
  attributions: Array<{ variantKey: VariantKey; _sum: { revenue: number | null } }>;
};

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

// Abramowitz & Stegun approximation of the standard normal CDF (max error 7.5e-8)
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const phi = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? phi : 1 - phi;
}

// Two-proportion z-test (two-tailed). Returns p-value and derived confidence.
function twoProportionZTest(nA: number, cA: number, nB: number, cB: number) {
  if (nA < 1 || nB < 1) return { pValue: 1, confidence: 0, significant: false };
  const pPool = (cA + cB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
  if (se === 0) return { pValue: 1, confidence: 0, significant: false };
  const z = Math.abs(cB / nB - cA / nA) / se;
  const pValue = 2 * (1 - normalCDF(z));
  const confidence = Math.round((1 - pValue) * 1000) / 10; // one decimal, e.g. 95.3
  return { pValue, confidence, significant: pValue < 0.05 };
}

// Minimum visitors per group needed to detect a 10% relative lift at α=0.05, power=80%.
function minSampleSizePerGroup(baselineRate: number): number {
  if (baselineRate <= 0 || baselineRate >= 1) return 1000;
  const delta = baselineRate * 0.1;
  const pB = Math.min(baselineRate + delta, 0.999);
  const z = 2.802; // z_α/2 + z_β = 1.96 + 0.842
  return Math.ceil((z * z * (baselineRate * (1 - baselineRate) + pB * (1 - pB))) / (delta * delta));
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
  const { pValue, confidence, significant } = twoProportionZTest(visitorsA, purchasesA, visitorsB, purchasesB);
  const certaintyScore = Math.round(confidence);
  const minSample = minSampleSizePerGroup(cvrA);
  const samplesNeeded = Math.max(0, minSample - Math.min(visitorsA, visitorsB));
  const winner: VariantKey | "Tie" = cvrA === cvrB ? "Tie" : cvrB > cvrA ? "B" : "A";

  return {
    id: experiment.id,
    name: experiment.name,
    status: experiment.status,
    statusLabel: statusLabel(experiment.status),
    targetType: experiment.targetType,
    targetValue: experiment.targetValue,
    trafficSplitA: experiment.trafficSplitA,
    assignmentMode: experiment.assignmentMode,
    assignmentTtlDays: experiment.assignmentTtlDays,
    audienceRule: experiment.audienceRule,
    verificationMode: experiment.verificationMode,
    verificationSwapSeconds: experiment.verificationSwapSeconds,
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
    pValue,
    confidence,
    significant,
    samplesNeeded,
    certaintyScore,
    winner,
  };
}

export async function listExperimentAnalytics(shopId: string) {
  const experiments = await listExperiments(shopId);
  if (experiments.length === 0) return [];

  const experimentIds = experiments.map((experiment) => experiment.id);
  const [assignments, events, attributions] = await Promise.all([
    prisma.visitorAssignment.groupBy({
      by: ["experimentId", "variantKey"],
      where: { experimentId: { in: experimentIds } },
      _count: { _all: true },
    }),
    prisma.event.groupBy({
      by: ["experimentId", "variantKey", "eventType"],
      where: { experimentId: { in: experimentIds } },
      _count: { _all: true },
    }),
    prisma.orderAttribution.groupBy({
      by: ["experimentId", "variantKey"],
      where: { experimentId: { in: experimentIds } },
      _sum: { revenue: true },
    }),
  ]);

  const assignmentMap = new Map<string, Summary["assignments"]>();
  assignments.forEach((row) => {
    const rows = assignmentMap.get(row.experimentId) ?? [];
    rows.push({ variantKey: row.variantKey, _count: row._count });
    assignmentMap.set(row.experimentId, rows);
  });

  const eventMap = new Map<string, Summary["events"]>();
  events.forEach((row) => {
    const rows = eventMap.get(row.experimentId) ?? [];
    rows.push({ variantKey: row.variantKey, eventType: row.eventType, _count: row._count });
    eventMap.set(row.experimentId, rows);
  });

  const attributionMap = new Map<string, Summary["attributions"]>();
  attributions.forEach((row) => {
    const rows = attributionMap.get(row.experimentId) ?? [];
    rows.push({ variantKey: row.variantKey, _sum: { revenue: row._sum.revenue ?? 0 } });
    attributionMap.set(row.experimentId, rows);
  });

  return experiments.map((experiment) =>
    summarizeExperiment(experiment, {
      assignments: assignmentMap.get(experiment.id) ?? [],
      events: eventMap.get(experiment.id) ?? [],
      attributions: attributionMap.get(experiment.id) ?? [],
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
