import { z } from "zod";

export const PlanCodeSchema = z.enum(["individual", "band_10", "band_20"]);
export const BandStatusSchema = z.enum([
  "draft",
  "trial",
  "pending_payment",
  "active",
  "past_due",
  "suspended",
  "cancelled",
]);
export const UserStatusSchema = z.enum(["active", "suspended", "deleted"]);

export const RegisterUserSchema = z.object({
  full_name: z.string().min(3).max(200),
  cpf: z.string().regex(/^\d{11}$/),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  email: z.string().email().max(320),
  phone: z.string().min(10).max(20),
  address_street: z.string().min(1).max(200),
  address_number: z.string().min(1).max(20),
  address_complement: z.string().max(100).optional(),
  address_neighborhood: z.string().min(1).max(100),
  address_city: z.string().min(1).max(100),
  address_state: z.string().length(2),
  address_zip: z.string().regex(/^\d{8}$/),
  password: z.string().min(8).max(128),
});

export const LoginSchema = z.object({
  login: z.string().min(3).max(320),
  password: z.string().min(8).max(128),
});

export const CreateBandSchema = z.object({
  name: z.string().min(2).max(200),
  plan_code: PlanCodeSchema,
});

export const BandSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  plan_code: PlanCodeSchema,
  status: BandStatusSchema,
  member_count: z.number().int(),
  member_limit: z.number().int(),
  billing_exempt: z.boolean(),
  can_analyze_songs: z.boolean(),
  is_owner: z.boolean(),
});

export const InvoiceSummarySchema = z.object({
  id: z.string(),
  total_amount_cents: z.number().int(),
  status: z.enum(["pending", "paid", "overdue", "cancelled"]),
  due_date: z.string(),
  paid_at: z.string().datetime().nullable(),
  payment_method: z.enum(["pix", "credit_card"]).nullable(),
  invoice_url: z.string().url().nullable(),
  line_items: z.array(
    z.object({
      band_id: z.string(),
      description: z.string(),
      amount_cents: z.number().int(),
    }),
  ),
});

export type PlanCode = z.infer<typeof PlanCodeSchema>;
export type RegisterUser = z.infer<typeof RegisterUserSchema>;
export type LoginRequest = z.infer<typeof LoginSchema>;
export type BandSummary = z.infer<typeof BandSummarySchema>;
