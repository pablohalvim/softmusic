import type { Route } from "./+types/billing.invoices";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/billing/invoices", request);
}
