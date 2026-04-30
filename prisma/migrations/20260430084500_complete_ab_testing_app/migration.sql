DROP INDEX IF EXISTS "OrderAttribution_orderId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "OrderAttribution_experimentId_orderId_key"
  ON "OrderAttribution"("experimentId", "orderId");
