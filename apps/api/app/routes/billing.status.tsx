import { z } from "zod";
import type { Route } from "./+types/billing.status";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/billing/status", request);
}
