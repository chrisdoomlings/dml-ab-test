import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { login } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await login(request);
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  await login(request);
  return null;
}
