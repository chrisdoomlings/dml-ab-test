import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const host = url.searchParams.get("host");

  if (shop) {
    const authUrl = new URL("/auth", url.origin);
    authUrl.searchParams.set("shop", shop);
    if (host) authUrl.searchParams.set("host", host);
    return redirect(authUrl.toString());
  }

  return redirect("/app");
}

export default function IndexRoute() {
  return null;
}
