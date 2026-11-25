import { publicRoute } from "@/lib/server/public-route";
import { vendorRunSheet } from "@/lib/server/lifecycle";

type Ctx = { params: Promise<{ token: string }> };
export const GET = publicRoute<Ctx>(async (_req, { params }) => vendorRunSheet((await params).token));
