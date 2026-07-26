import type { Route } from "./+types/admin.billing.invoices.$invoiceId.payment-link";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";
import { saasOptions } from "../server/saas-routes.server";

export async function action({ request, params }: Route.ActionArgs) {
  const options = saasOptions(request);
  if (options) return options;
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }
  return proxyJson(
    `/admin/billing/invoices/${params.invoiceId}/payment-link`,
    { method: "POST" },
    request,
  );
}
