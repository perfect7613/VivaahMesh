import "server-only";
import { timingSafeEqual } from "node:crypto";

export function authorizedOps(req: Request) {
  const want = Buffer.from(process.env.OPS_SECRET ?? "");
  const got = Buffer.from(req.headers.get("x-ops-secret") ?? "");
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}
