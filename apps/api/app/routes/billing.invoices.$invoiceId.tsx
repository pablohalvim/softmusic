import type { Route } from "./+types/billing.invoices.$invoiceId";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return saasProxy(`/billing/invoices/${params.invoiceId}`, request);
}
