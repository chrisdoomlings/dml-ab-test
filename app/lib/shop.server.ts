import { prisma } from "./db.server";
import { authenticate } from "../shopify.server";

export async function requireShopRecord(request: Request) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  if (!shopDomain) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return prisma.shop.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
      accessToken: session.accessToken || "",
    },
    update: {
      accessToken: session.accessToken || "",
    },
  });
}
