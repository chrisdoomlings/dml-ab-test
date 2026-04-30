import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import { ExperimentStatus } from "@prisma/client";
import { deleteExperiment, getExperimentSummary, updateExperimentStatus } from "../models/experiments.server";
import { summarizeExperiment } from "../lib/analytics.server";
import { money, percent, signedPercent } from "../lib/format";
import { prisma } from "../lib/db.server";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const experiment = await prisma.experiment.findFirst({
    where: { id, shopId: shop.id },
    include: { variants: true },
  });
  if (!experiment) throw new Response("Not found", { status: 404 });

  const summary = await getExperimentSummary(id);
  return json({ experiment: summarizeExperiment(experiment, summary) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const shop = await requireShopRecord(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "delete") {
    await deleteExperiment({ id, shopId: shop.id });
    return redirect("/app");
  }

  if (["DRAFT", "ACTIVE", "PAUSED", "STOPPED"].includes(intent)) {
    await updateExperimentStatus({
      id,
      shopId: shop.id,
      status: intent as ExperimentStatus,
    });
    return redirect(`/app/experiments/${id}`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

function selectorFor(experiment: ReturnType<typeof useLoaderData<typeof loader>>["experiment"], key: "A" | "B") {
  return experiment.variants.find((variant) => variant.key === key)?.selector ?? "No selector";
}

function MiniChart({ cvrA, cvrB }: { cvrA: number; cvrB: number }) {
  const pointsA = [0.82, 0.9, 0.76, 0.8, 0.87, Math.max(0.18, 0.78 - cvrA * 5)];
  const pointsB = [0.62, 0.68, 0.72, 0.9, 0.84, Math.max(0.12, 0.74 - cvrB * 5)];
  const toPath = (points: number[]) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${24 + index * 118} ${28 + point * 128}`).join(" ");

  return (
    <svg className="chart" viewBox="0 0 660 220" role="img" aria-label="Conversion rate trend">
      {[40, 90, 140, 190].map((y) => (
        <line key={y} x1="24" x2="636" y1={y} y2={y} stroke="#dfe3e8" strokeDasharray="5 5" />
      ))}
      <path d={toPath(pointsA)} fill="none" stroke="#111111" strokeWidth="3" />
      <path d={toPath(pointsB)} fill="none" stroke="#3d7cff" strokeWidth="3" />
      <circle cx="614" cy={28 + pointsB[5] * 128} r="5" fill="#3d7cff" />
      <text x="24" y="212" fill="#656b73" fontSize="13">
        Day 1
      </text>
      <text x="560" y="212" fill="#656b73" fontSize="13">
        Today
      </text>
    </svg>
  );
}

export default function ExperimentDetailsPage() {
  const { experiment } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const probabilityB = experiment.certaintyScore;
  const probabilityA = 100 - probabilityB;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">Test overview</div>
          <h1 className="page-title">{experiment.name}</h1>
          <p className="page-subtitle">
            {experiment.statusLabel} test on {experiment.targetValue || experiment.targetType.toLowerCase().replace("_", " ")}
          </p>
        </div>
        <Form method="post" className="button-row">
          <button className="button-secondary" name="intent" value="ACTIVE" disabled={isSubmitting || experiment.status === "ACTIVE"}>
            Activate
          </button>
          <button className="button-secondary" name="intent" value="PAUSED" disabled={isSubmitting || experiment.status === "PAUSED"}>
            Pause
          </button>
          <button className="button-secondary" name="intent" value="STOPPED" disabled={isSubmitting || experiment.status === "STOPPED"}>
            Stop
          </button>
          <button className="button-danger" name="intent" value="delete" disabled={isSubmitting}>
            Delete
          </button>
        </Form>
      </div>

      <section className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">Visitors</div>
          <div className="metric-value">{experiment.visitors.toLocaleString()}</div>
          <div className="metric-delta">A {experiment.visitorsA.toLocaleString()} / B {experiment.visitorsB.toLocaleString()}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Lift</div>
          <div className="metric-value">{signedPercent(experiment.cvrLift)}</div>
          <div className="metric-delta">Conversion rate goal</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Progress</div>
          <div className="metric-value">{experiment.certaintyScore >= 85 ? "Significant" : "Learning"}</div>
          <div className="metric-delta">{experiment.certaintyScore}% certainty</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Revenue</div>
          <div className="metric-value">{money(experiment.revenueA + experiment.revenueB)}</div>
          <div className="metric-delta">Orders data after approval</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Conversion rate</div>
          <div className="test-meta">
            <span className="chip">Original {percent(experiment.cvrA)}</span>
            <span className="chip">Variant {percent(experiment.cvrB)}</span>
          </div>
        </div>
        <div className="chart-wrap">
          <MiniChart cvrA={experiment.cvrA} cvrB={experiment.cvrB} />
        </div>
      </section>

      <section className="variants-grid">
        <div className="variant-card">
          <div className="variant-header">
            <strong>Original</strong>
            <span className="status-chip">Probability to win: {probabilityA}%</span>
          </div>
          <div className="variant-preview">
            <span className="preview-label">{selectorFor(experiment, "A")}</span>
          </div>
          <div className="stat-list">
            <div className="stat-row"><span>Visitors</span><strong>{experiment.visitorsA.toLocaleString()}</strong></div>
            <div className="stat-row"><span>CTR</span><strong>{percent(experiment.ctrA)}</strong></div>
            <div className="stat-row"><span>Add-to-cart rate</span><strong>{percent(experiment.atcA)}</strong></div>
            <div className="stat-row"><span>RPV</span><strong>{money(experiment.rpvA)}</strong></div>
          </div>
        </div>

        <div className="variant-card">
          <div className="variant-header">
            <strong>Variant</strong>
            <span className="status-chip significant">Probability to win: {probabilityB}%</span>
          </div>
          <div className="variant-preview variant-b">
            <span className="preview-label">{selectorFor(experiment, "B")}</span>
          </div>
          <div className="stat-list">
            <div className="stat-row"><span>Visitors</span><strong>{experiment.visitorsB.toLocaleString()}</strong></div>
            <div className="stat-row"><span>CTR</span><strong>{percent(experiment.ctrB)}</strong></div>
            <div className="stat-row"><span>Add-to-cart rate</span><strong>{percent(experiment.atcB)}</strong></div>
            <div className="stat-row"><span>RPV</span><strong>{money(experiment.rpvB)}</strong></div>
          </div>
        </div>
      </section>

      <div style={{ marginTop: 18 }}>
        <Link className="button-secondary" to="/app">
          Back to tests
        </Link>
      </div>
    </>
  );
}
