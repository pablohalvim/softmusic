import type { Route } from "./+types/billing.invoices.$invoiceId.refresh";
import { saasProxy } from "../server/saas-routes.server";

export async function action({ request, params }: Route.ActionArgs) {
  return saasProxy(`/billing/invoices/${params.invoiceId}/refresh`, request, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}