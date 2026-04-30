import { prisma } from "./db.server";
import { authenticate } from "../shopify.server";

export async function requireShopRecord(request: Request) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  if (!shopDomain) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const accessToken = session.accessToken || "";
  const existing = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!existing) {
    return prisma.shop.create({
      data: {
        shopDomain,
        accessToken,
      },
    });
  }

  // Avoid a write on every request; only update token when it actually changed.
  if (existing.accessToken !== accessToken) {
    return prisma.shop.update({
      where: { id: existing.id },
      data: { accessToken },
    });
  }

  return existing;
}
