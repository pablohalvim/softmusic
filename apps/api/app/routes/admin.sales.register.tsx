import { z } from "zod";
import type { Route } from "./+types/admin.sales.register";
import { saasJsonAction } from "../server/saas-routes.server";

const Schema = z
  .object({
    full_name: z.string().min(1),
    cpf: z.string().min(11).max(14),
    is_company: z.boolean().optional().default(false),
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
  })
  .superRefine((data, ctx) => {
    const digits = data.cpf.replace(/\D/g, "");
    if (data.is_company) {
      if (digits.length !== 14) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CNPJ inválido", path: ["cpf"] });
      }
    } else if (digits.length !== 11) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CPF inválido", path: ["cpf"] });
    }
  });

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/admin/sales/register", Schema, "POST");
}
