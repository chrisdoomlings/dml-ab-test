import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { listExperimentAnalytics, totals } from "../lib/analytics.server";
import { money, percent, signedPercent } from "../lib/format";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const experiments = await listExperimentAnalytics(shop.id);
  const summary = totals(experiments);
  return json({ experiments, summary });
}

function statusClass(status: string) {
  return status.toLowerCase();
}

function targetLabel(targetType: string, targetValue?: string | null) {
  if (targetType === "ALL_PAGES") return "All pages";
  if (targetType === "TEMPLATE") return `${targetValue || "Template"} template`;
  if (targetType === "PATH_PREFIX") return `${targetValue || "Path"} prefix`;
  return targetValue || "Exact path";
}

function dateLabel(value: string | Date | null) {
  if (!value) return "Not started";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AppIndex() {
  const { experiments, summary } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") ?? "live";
  const filtered = experiments.filter((experiment) => {
    if (currentTab === "draft") return experiment.status === "DRAFT";
    if (currentTab === "ended") return experiment.status === "STOPPED";
    return experiment.status === "ACTIVE" || experiment.status === "PAUSED";
  });
  const averageLift = summary.tests > 0 ? summary.lift / summary.tests : 0;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">Experiment command center</div>
          <h1 className="page-title">Welcome back</h1>
          <p className="page-subtitle">Monitor live tests, certainty, conversion lift, and revenue impact.</p>
        </div>
        <Link className="button-primary" to="/app/experiments/new">
          Create a test
        </Link>
      </div>

      <section className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">Live tests</div>
          <div className="metric-value">{summary.live}</div>
          <div className="metric-delta">{summary.tests} total tests</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Visitors assigned</div>
          <div className="metric-value">{summary.visitors.toLocaleString()}</div>
          <div className="metric-delta">Across all variants</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Average CVR lift</div>
          <div className="metric-value">{signedPercent(averageLift)}</div>
          <div className="metric-delta">Variant vs original</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Attributed revenue</div>
          <div className="metric-value">{money(summary.revenue)}</div>
          <div className="metric-delta">Approval-gated orders data</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="tabs">
            <Link className={`tab ${currentTab === "live" ? "active" : ""}`} to="/app?tab=live">
              Live
            </Link>
            <Link className={`tab ${currentTab === "draft" ? "active" : ""}`} to="/app?tab=draft">
              Draft
            </Link>
            <Link className={`tab ${currentTab === "ended" ? "active" : ""}`} to="/app?tab=ended">
              Ended
            </Link>
          </div>
          <Link className="button-secondary" to="/app/analytics">
            View reporting
          </Link>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <h2 className="panel-title">No tests in this view</h2>
            <p className="page-subtitle">Create a test or switch tabs to inspect existing experiments.</p>
          </div>
        ) : (
          <table className="test-table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Started</th>
                <th>Lift</th>
                <th>Certainty</th>
                <th>CVR</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((experiment) => (
                <tr key={experiment.id}>
                  <td>
                    <Link className="test-name" to={`/app/experiments/${experiment.id}`}>
                      {experiment.name}
                    </Link>
                    <div className="test-meta">
                      <span className={`status-chip ${statusClass(experiment.statusLabel)}`}>
                        {experiment.statusLabel}
                      </span>
                      <span className="chip">{targetLabel(experiment.targetType, experiment.targetValue)}</span>
                      <span className="chip">A {experiment.trafficSplitA}% / B {100 - experiment.trafficSplitA}%</span>
                    </div>
                  </td>
                  <td>{dateLabel(experiment.startedAt || experiment.createdAt)}</td>
                  <td>
                    <span className={`lift-chip ${experiment.cvrLift < 0 ? "negative" : ""}`}>
                      {signedPercent(experiment.cvrLift)}
                    </span>
                  </td>
                  <td>
                    <span className={`status-chip ${experiment.certaintyScore >= 85 ? "significant" : ""}`}>
                      {experiment.certaintyScore >= 85 ? "Significant" : "Gathering data"}
                    </span>
                  </td>
                  <td>
                    {percent(experiment.cvrB)} <span className="page-subtitle">variant</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
