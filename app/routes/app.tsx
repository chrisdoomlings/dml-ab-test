import { NavLink, Outlet, useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import appStyles from "../styles/app.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: appStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  return json({
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    host: url.searchParams.get("host") ?? "",
    shopName: session.shop.replace(".myshopify.com", ""),
  });
}

export default function AppLayout() {
  const { apiKey, host, shopName } = useLoaderData<typeof loader>();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey} host={host}>
      <div className="app-shell">
        <header className="app-topbar">
          <div className="app-brand">
            <span className="app-mark">D</span>
            <span>DML Lift</span>
          </div>
          <div className="app-top-actions">
            <a className="button-secondary" href="/app/settings">
              Settings
            </a>
            <span className="app-avatar">{shopName.slice(0, 2).toUpperCase()}</span>
          </div>
        </header>
        <div className="app-frame">
          <aside className="app-sidebar">
            <div className="store-badge">PRO</div>
            <div className="store-name">{shopName} store</div>
            <nav className="side-nav" aria-label="App navigation">
              <NavLink to="/app" end>
                <span>Tests</span>
                <span>AB</span>
              </NavLink>
              <NavLink to="/app/analytics">
                <span>Analytics</span>
                <span>%</span>
              </NavLink>
              <NavLink to="/app/assist">
                <span>Lift Assist</span>
                <span>AI</span>
              </NavLink>
              <NavLink to="/app/settings">
                <span>Settings</span>
                <span>...</span>
              </NavLink>
            </nav>
            <a className="sidebar-create" href="/app/experiments/new">
              Create a test +
            </a>
          </aside>
          <main className="app-content">
            <Outlet />
          </main>
        </div>
      </div>
    </AppProvider>
  );
}
