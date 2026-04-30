import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireShopRecord } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await requireShopRecord(request);
  return json({ shop });
}

export default function SettingsPage() {
  const { shop } = useLoaderData<typeof loader>();

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">Settings</div>
          <h1 className="page-title">Measurement setup</h1>
          <p className="page-subtitle">Storefront tracking, attribution status, and data controls for this store.</p>
        </div>
      </div>

      <section className="settings-grid">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Store connection</div>
            <span className="status-chip significant">Connected</span>
          </div>
          <div className="variant-card" style={{ border: 0 }}>
            <div className="stat-list">
              <div className="stat-row"><span>Shop domain</span><strong>{shop.shopDomain}</strong></div>
              <div className="stat-row"><span>Theme app extension</span><strong>Enabled in theme editor</strong></div>
              <div className="stat-row"><span>Assignment storage</span><strong>LocalStorage</strong></div>
              <div className="stat-row"><span>Fail-open behavior</span><strong>Variant A visible</strong></div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Revenue attribution</div>
            <span className="status-chip paused">Approval needed</span>
          </div>
          <div className="variant-card" style={{ border: 0 }}>
            <div className="stat-list">
              <div className="stat-row"><span>Order webhook</span><strong>Disabled</strong></div>
              <div className="stat-row"><span>Required scope</span><strong>read_orders</strong></div>
              <div className="stat-row"><span>Protected data review</span><strong>Required by Shopify</strong></div>
              <div className="stat-row"><span>Current revenue cards</span><strong>Ready, waiting for approval</strong></div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Analytics goals</div>
            <span className="status-chip active">Active</span>
          </div>
          <div className="variant-card" style={{ border: 0 }}>
            <div className="stat-list">
              <div className="stat-row"><span>Primary goal</span><strong>Conversion rate</strong></div>
              <div className="stat-row"><span>Secondary goal</span><strong>Add-to-cart rate</strong></div>
              <div className="stat-row"><span>Reporting metrics</span><strong>CVR, CTR, ATC, RPV, AOV</strong></div>
              <div className="stat-row"><span>Certainty threshold</span><strong>85%</strong></div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Data quality</div>
            <span className="status-chip active">Healthy</span>
          </div>
          <div className="variant-card" style={{ border: 0 }}>
            <div className="stat-list">
              <div className="stat-row"><span>Assignment rule</span><strong>One visitor per test</strong></div>
              <div className="stat-row"><span>Public API</span><strong>CORS enabled</strong></div>
              <div className="stat-row"><span>Webhook auth</span><strong>Implemented</strong></div>
              <div className="stat-row"><span>Migration status</span><strong>Manual SQL included</strong></div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
