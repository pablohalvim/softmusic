import type { Route } from "./+types/webhooks.asaas";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }
  const body = await request.json();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const asaasToken = request.headers.get("asaas-access-token");
  if (asaasToken) {
    headers["asaas-access-token"] = asaasToken;
  }
  return proxyJson(
    "/webhooks/asaas",
    { method: "POST", headers, body: JSON.stringify(body) },
    request,
  );
}
