import { Outlet, useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu, TitleBar } from "@shopify/app-bridge-react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import appStyles from "../styles/app.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: appStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const url = new URL(request.url);
  return json({
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    host: url.searchParams.get("host") ?? "",
  });
}

export default function AppLayout() {
  const { apiKey, host } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey} host={host}>
      <TitleBar title="DML AB Test" />
      <NavMenu>
        <a href="/app" rel="home">
          Tests
        </a>
        <a href="/app/analytics">Analytics</a>
        <a href="/app/assist">Lift Assist</a>
        <a href="/app/settings">Settings</a>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}
