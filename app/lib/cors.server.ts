function configuredOrigins() {
  return (process.env.SHOPIFY_STOREFRONT_ORIGINS || process.env.SHOPIFY_CUSTOM_DOMAIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizeHost(value: string) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export function isAllowedStorefrontOrigin(request: Request, shopDomain?: string | null) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  let originHost = "";
  try {
    originHost = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  const allowedHosts = configuredOrigins().map(normalizeHost);
  if (shopDomain) allowedHosts.push(normalizeHost(shopDomain));

  return allowedHosts.includes(originHost) || originHost.endsWith(".myshopify.com");
}

export function corsHeaders(request: Request, shopDomain?: string | null) {
  const origin = request.headers.get("Origin");
  const allowOrigin = origin && isAllowedStorefrontOrigin(request, shopDomain) ? origin : "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export function optionsResponse(request: Request, shopDomain?: string | null) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, shopDomain),
  });
}
