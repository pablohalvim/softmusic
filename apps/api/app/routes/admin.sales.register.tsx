import { z } from "zod";
import type { Route } from "./+types/admin.sales.register";
import { saasJsonAction } from "../server/saas-routes.server";

const Schema = z.object({
  full_name: z.string().min(1),
  cpf: z.string().min(11),
  birth_date: z.string().min(8),
  email: z.string().email(),
  phone: z.string().min(8),
  address_street: z.string().min(1),
  address_number: z.string().min(1),
  address_complement: z.string().optional().nullable(),
  address_neighborhood: z.string().min(1),
  address_city: z.string().min(1),
  address_state: z.string().min(2).max(2),
  address_zip: z.string().min(8),
  password: z.string().min(8).optional().nullable(),
  band_name: z.string().min(1),
  plan_code: z.enum(["individual", "band_10", "band_20"]),
});

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/admin/sales/register", Schema, "POST");
}
