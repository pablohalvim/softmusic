import type { Route } from "./+types/admin.billing.suspend-overdue";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }
  return proxyJson("/admin/billing/suspend-overdue", { method: "POST" }, request);
}
