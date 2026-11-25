import { HttpError } from "@/lib/server/http-error";
import { jsonObject } from "@/lib/server/request-body";
import { bridgeAuthorized, receiveWhatsApp } from "@/lib/server/whatsapp";

export const maxDuration = 45;

export async function POST(req: Request) {
  if (!bridgeAuthorized(process.env.BRIDGE_SECRET, req.headers.get("x-bridge-secret"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await receiveWhatsApp(await jsonObject(req, 1_410_000)));
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    console.error("whatsapp_bridge_request_failed");
    return Response.json({ error: "bridge_request_failed" }, { status: 503 });
  }
}
