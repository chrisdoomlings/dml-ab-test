import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getActiveExperimentsForPath, assignVariant } from "../models/experiments.server";
import { prisma } from "../lib/db.server";

function requireParam(url: URL, key: string) {
  const value = url.searchParams.get(key);
  if (!value) throw new Response(`Missing query param: ${key}`, { status: 400 });
  return value;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shopDomain = requireParam(url, "shop");
  const path = requireParam(url, "path");
  const visitorId = requireParam(url, "visitorId");
  const template = url.searchParams.get("template") ?? undefined;

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return json({ experiments: [] });

  const experiments = await getActiveExperimentsForPath(shop.id, path, template);

  const withAssignments = await Promise.all(
    experiments.map(async (experiment) => {
      const variant = await assignVariant(experiment.id, visitorId, experiment.trafficSplitA);
      const variantSelectors = experiment.variants.reduce<Record<string, string>>((acc, v) => {
        acc[v.key] = v.selector;
        return acc;
      }, {});

      return {
        id: experiment.id,
        name: experiment.name,
        variant,
        variants: variantSelectors,
      };
    }),
  );

  return json({ experiments: withAssignments });
}
