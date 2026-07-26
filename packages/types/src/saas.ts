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
  invite_token: z.string().min(1).optional(),
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
  can_invite_members: z.boolean().optional(),
  can_manage_members: z.boolean().optional(),
  can_delete_songs: z.boolean().optional(),
  is_owner: z.boolean(),
  is_blocked: z.boolean().optional(),
  trial_ends_at: z.string().nullable().optional(),
});

export const BandRoleSchema = z.object({
  id: z.string(),
  band_id: z.string(),
  name: z.string(),
  sort_order: z.number().int(),
  is_default: z.boolean(),
});

export const BandMemberDetailSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  full_name: z.string(),
  email: z.string().email(),
  is_owner: z.boolean(),
  joined_at: z.string().nullable(),
  roles: z.array(BandRoleSchema),
  can_analyze_songs: z.boolean(),
  can_invite_members: z.boolean(),
  can_manage_members: z.boolean(),
  can_delete_songs: z.boolean().optional(),
});

export const SavedAddressSchema = z.object({
  id: z.string(),
  band_id: z.string(),
  label: z.string(),
  formatted_address: z.string(),
  lat: z.number(),
  lng: z.number(),
  place_id: z.string().nullable().optional(),
  maps_url: z.string().optional(),
});

export const ScheduleMemberSchema = z.object({
  member_id: z.string(),
  full_name: z.string(),
  role_names: z.array(z.string()).optional(),
  label: z.string().optional(),
});

export const ScheduleGridRowSchema = z.object({
  occurrence_id: z.string(),
  schedule_id: z.string(),
  title: z.string().nullable(),
  kind: z.enum(["event", "rehearsal"]),
  starts_at: z.string(),
  ends_at: z.string(),
  formatted_address: z.string(),
  lat: z.number(),
  lng: z.number(),
  place_id: z.string().nullable().optional(),
  maps_url: z.string(),
  member_count: z.number().int(),
  members: z.array(ScheduleMemberSchema),
});

export const UpcomingOccurrenceSchema = z.object({
  id: z.string(),
  schedule_id: z.string(),
  kind: z.enum(["event", "rehearsal"]),
  title: z.string().nullable().optional(),
  band_id: z.string(),
  band_name: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  formatted_address: z.string(),
  lat: z.number(),
  lng: z.number(),
  maps_url: z.string(),
  members: z.array(ScheduleMemberSchema).optional(),
});

export const InvoiceSummarySchema = z.object({
  id: z.string(),
  invoice_number: z.number().int().nullable().optional(),
  invoice_kind: z.enum(["first", "recurrence"]).optional(),
  total_amount_cents: z.number().int(),
  status: z.enum(["awaiting_payment", "paid", "overdue", "cancelled", "refunded", "pending"]),
  due_date: z.string(),
  paid_at: z.string().nullable(),
  payment_method: z.string().nullable(),
  invoice_url: z.string().nullable(),
  can_pay: z.boolean().optional(),
  can_refresh: z.boolean().optional(),
  has_asaas_link: z.boolean().optional(),
  line_items: z.array(
    z.object({
      band_id: z.string(),
      description: z.string(),
      amount_cents: z.number().int(),
      plan_code: z.string().nullable().optional(),
      item_kind: z.string().optional(),
      quantity: z.number().int().optional(),
      unit_amount_cents: z.number().int().optional(),
      band_name: z.string().nullable().optional(),
      plan_label: z.string().nullable().optional(),
    }),
  ),
});

export const PendingInviteSchema = z.object({
  id: z.string(),
  band_id: z.string(),
  band_name: z.string(),
  email: z.string().email(),
  can_analyze_songs: z.boolean(),
  can_invite_members: z.boolean().optional().default(false),
  can_manage_members: z.boolean().optional().default(false),
  can_delete_songs: z.boolean().optional().default(false),
  expires_at: z.string(),
  created_at: z.string(),
});

export type PlanCode = z.infer<typeof PlanCodeSchema>;
export type RegisterUser = z.infer<typeof RegisterUserSchema>;
export type LoginRequest = z.infer<typeof LoginSchema>;
export type BandSummary = z.infer<typeof BandSummarySchema>;
export type PendingInvite = z.infer<typeof PendingInviteSchema>;
export type BandRole = z.infer<typeof BandRoleSchema>;
export type BandMemberDetail = z.infer<typeof BandMemberDetailSchema>;
export type SavedAddress = z.infer<typeof SavedAddressSchema>;
export type UpcomingOccurrence = z.infer<typeof UpcomingOccurrenceSchema>;
