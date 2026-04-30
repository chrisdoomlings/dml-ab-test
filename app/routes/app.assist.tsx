import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { listExperimentAnalytics } from "../lib/analytics.server";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  const experiments = await listExperimentAnalytics(shop.id);
  const liveCount = experiments.filter((experiment) => experiment.status === "ACTIVE").length;
  return json({ liveCount });
}

const ideas = [
  {
    title: "Homepage hero offer test",
    metric: "CVR",
    target: "Homepage",
    lift: "+8% to +18%",
    detail: "Compare benefit-led hero copy against product-led hero copy with the same traffic split.",
  },
  {
    title: "Collection product-card density",
    metric: "CTR",
    target: "Collection page",
    lift: "+5% to +12%",
    detail: "Test compact cards against larger visual cards to see which layout drives more product visits.",
  },
  {
    title: "Sticky add-to-cart proof point",
    metric: "ATC",
    target: "Product page",
    lift: "+4% to +10%",
    detail: "Add delivery, returns, or guarantee messaging near the purchase action.",
  },
  {
    title: "Announcement bar urgency",
    metric: "RPV",
    target: "All pages",
    lift: "+3% to +9%",
    detail: "Compare a simple free-shipping threshold against time-limited promotion copy.",
  },
];

export default function AssistPage() {
  const { liveCount } = useLoaderData<typeof loader>();

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">Lift Assist</div>
          <h1 className="page-title">Testing roadmap</h1>
          <p className="page-subtitle">Prioritized ideas for conversion, product discovery, and revenue-per-visitor gains.</p>
        </div>
        <Link className="button-primary" to="/app/experiments/new">
          Build from idea
        </Link>
      </div>

      <section className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">Live coverage</div>
          <div className="metric-value">{liveCount}</div>
          <div className="metric-delta">Active tests running</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Recommended queue</div>
          <div className="metric-value">{ideas.length}</div>
          <div className="metric-delta">Ready to launch</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Primary focus</div>
          <div className="metric-value">CVR</div>
          <div className="metric-delta">Conversion rate</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Next review</div>
          <div className="metric-value">7d</div>
          <div className="metric-delta">After sample growth</div>
        </div>
      </section>

      <section className="insight-grid">
        {ideas.map((idea) => (
          <article className="insight-card" key={idea.title}>
            <div className="variant-header">
              <strong>{idea.title}</strong>
              <span className="lift-chip">{idea.lift}</span>
            </div>
            <div className="test-meta">
              <span className="chip">{idea.target}</span>
              <span className="chip">{idea.metric}</span>
            </div>
            <p className="page-subtitle">{idea.detail}</p>
          </article>
        ))}
      </section>
    </>
  );
}
