import { z } from "zod";
import type { Route } from "./+types/billing.checkout";
import { saasJsonAction } from "../server/saas-routes.server";

const CreditCardSchema = z.object({
  holder_name: z.string().min(1),
  number: z.string().min(13).max(19),
  expiry_month: z.string().min(2).max(2),
  expiry_year: z.string().min(4).max(4),
  ccv: z.string().min(3).max(4),
});

const CheckoutSchema = z.object({
  payment_method: z.enum(["pix", "credit_card"]),
  credit_card: CreditCardSchema.optional(),
  holder_info: z.record(z.string()).optional(),
});

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/billing/checkout", CheckoutSchema);
}
