import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { listExperimentAnalytics, metricTotals, totals } from "../lib/analytics.server";
import { money, percent, signedPercent } from "../lib/format";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const experiments = await listExperimentAnalytics(shop.id);
  return json({
    experiments,
    summary: totals(experiments),
    events: metricTotals(experiments),
  });
}

function ReportingChart() {
  const original = [0.74, 0.58, 0.64, 0.49, 0.53, 0.62, 0.7, 0.59, 0.66];
  const variant = [0.86, 0.78, 0.73, 0.66, 0.44, 0.38, 0.52, 0.61, 0.57];
  const toPath = (points: number[]) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${28 + index * 76} ${26 + point * 150}`).join(" ");

  return (
    <svg className="chart" viewBox="0 0 680 240" role="img" aria-label="Reporting trend">
      {[42, 92, 142, 192].map((y) => (
        <line key={y} x1="28" x2="652" y1={y} y2={y} stroke="#dfe3e8" strokeDasharray="5 5" />
      ))}
      <path d={toPath(original)} fill="none" stroke="#111111" strokeWidth="3" />
      <path d={toPath(variant)} fill="none" stroke="#3d7cff" strokeWidth="3" />
      <text x="28" y="226" fill="#656b73" fontSize="13">Original</text>
      <text x="112" y="226" fill="#3d7cff" fontSize="13">Variant</text>
    </svg>
  );
}

export default function AnalyticsPage() {
  const { experiments, summary, events } = useLoaderData<typeof loader>();
  const averageLift = summary.tests > 0 ? summary.lift / summary.tests : 0;
  const totalPurchases = events.PURCHASE;
  const totalAdds = events.ADD_TO_CART;
  const totalClicks = events.CLICK;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">Reporting</div>
          <h1 className="page-title">Robust reporting. Actionable analysis.</h1>
          <p className="page-subtitle">Compare conversion, add-to-cart, revenue, and certainty across every test.</p>
        </div>
        <Link className="button-primary" to="/app/experiments/new">
          Create a test
        </Link>
      </div>

      <section className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">Tests analyzed</div>
          <div className="metric-value">{summary.tests}</div>
          <div className="metric-delta">{summary.live} live now</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Visitor sample</div>
          <div className="metric-value">{summary.visitors.toLocaleString()}</div>
          <div className="metric-delta">{events.IMPRESSION.toLocaleString()} impressions</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Average lift</div>
          <div className="metric-value">{signedPercent(averageLift)}</div>
          <div className="metric-delta">CVR goal</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Revenue tracked</div>
          <div className="metric-value">{money(summary.revenue)}</div>
          <div className="metric-delta">{totalPurchases.toLocaleString()} purchases</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Conversion rate</div>
          <div className="test-meta">
            <span className="chip">Clicks {totalClicks.toLocaleString()}</span>
            <span className="chip">Adds {totalAdds.toLocaleString()}</span>
          </div>
        </div>
        <div className="chart-wrap">
          <ReportingChart />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Experiment performance</div>
          <span className="status-chip significant">Certainty model</span>
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>Visitors</th>
              <th>CVR</th>
              <th>Lift</th>
              <th>Revenue</th>
              <th>RPV</th>
              <th>Certainty</th>
            </tr>
          </thead>
          <tbody>
            {experiments.map((experiment) => (
              <tr key={experiment.id}>
                <td>
                  <Link className="test-name" to={`/app/experiments/${experiment.id}`}>
                    {experiment.name}
                  </Link>
                </td>
                <td>{experiment.visitors.toLocaleString()}</td>
                <td>{percent(experiment.cvrB)}</td>
                <td>
                  <span className={`lift-chip ${experiment.cvrLift < 0 ? "negative" : ""}`}>
                    {signedPercent(experiment.cvrLift)}
                  </span>
                </td>
                <td>{money(experiment.revenueA + experiment.revenueB)}</td>
                <td>{money(experiment.rpvB)}</td>
                <td>{experiment.certaintyScore}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
