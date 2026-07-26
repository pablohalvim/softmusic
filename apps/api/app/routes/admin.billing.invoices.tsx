import type { Route } from "./+types/admin.billing.invoices";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/admin/billing/invoices", request);
}
