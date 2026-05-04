import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { getActiveExperimentsForPath, assignVariant } from "../models/experiments.server";
import { prisma } from "../lib/db.server";
import { corsHeaders, isAllowedStorefrontOrigin, optionsResponse } from "../lib/cors.server";
import { isLikelyBot, isRateLimited } from "../lib/public-api-security.server";

function requireParam(url: URL, key: string, maxLen = 512) {
  const value = url.searchParams.get(key);
  if (!value) throw new Response(`Missing query param: ${key}`, { status: 400 });
  if (value.length > maxLen) throw new Response(`Query param too long: ${key}`, { status: 400 });
  return value;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return optionsResponse(request);
  return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders(request) });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shopDomain = requireParam(url, "shop", 255);
  const path = requireParam(url, "path", 2048);
  const visitorId = requireParam(url, "visitorId", 128);
  const rawSessionId = url.searchParams.get("sessionId");
  const sessionId = rawSessionId && rawSessionId.length <= 128 ? rawSessionId : undefined;
  const isReturning = url.searchParams.get("isReturning") === "1";
  const template = url.searchParams.get("template") ?? undefined;

  const headers = corsHeaders(request, shopDomain);
  if (!request.headers.get("Origin")) {
    return json({ experiments: [] }, { status: 403, headers });
  }
  if (!isAllowedStorefrontOrigin(request, shopDomain)) {
    return json({ experiments: [] }, { status: 403, headers });
  }

  if (isLikelyBot(request)) {
    return json({ experiments: [] }, { headers });
  }

  if (isRateLimited(request, [shopDomain, visitorId])) {
    return json({ error: "Too many requests" }, { status: 429, headers });
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return json({ experiments: [] }, { headers });

  const experiments = await getActiveExperimentsForPath(shop.id, path, template, isReturning);

  const withAssignments = await Promise.all(
    experiments.map(async (experiment) => {
      const variant = await assignVariant({
        experimentId: experiment.id,
        visitorId,
        splitA: experiment.trafficSplitA,
        assignmentMode: experiment.assignmentMode,
        assignmentTtlDays: experiment.assignmentTtlDays,
        sessionId,
      });
      const variantSelectors = experiment.variants.reduce<Record<string, string>>((acc, v) => {
        acc[v.key] = v.selector;
        return acc;
      }, {});

      return {
        id: experiment.id,
        name: experiment.name,
        variant,
        variants: variantSelectors,
        verificationMode: experiment.verificationMode,
        verificationSwapSeconds: experiment.verificationSwapSeconds,
      };
    }),
  );

  return json({ experiments: withAssignments }, { headers });
}
