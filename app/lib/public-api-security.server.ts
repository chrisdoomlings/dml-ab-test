import { isbot } from "isbot";

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 120;
const MAX_BODY_BYTES = 16 * 1024;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("cf-connecting-ip") || "unknown";
}

export function isReasonableBodySize(request: Request) {
  const contentLength = request.headers.get("content-length");
  return !contentLength || Number(contentLength) <= MAX_BODY_BYTES;
}

export function isLikelyBot(request: Request) {
  return isbot(request.headers.get("user-agent"));
}

export function isRateLimited(request: Request, keyParts: Array<string | null | undefined>) {
  const key = [clientIp(request), ...keyParts.filter(Boolean)].join(":");
  const now = Date.now();
  const existing = rateBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) {
        if (v.resetAt <= now) rateBuckets.delete(k);
      }
    }
    return false;
  }

  existing.count += 1;
  return existing.count > MAX_REQUESTS_PER_WINDOW;
}
