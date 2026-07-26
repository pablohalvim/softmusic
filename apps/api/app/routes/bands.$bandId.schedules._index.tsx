import { z } from "zod";
import type { Route } from "./+types/bands.$bandId.schedules._index";
import { saasJsonAction, saasProxy } from "../server/saas-routes.server";

const OccurrenceSchema = z.object({
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  formatted_address: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  place_id: z.string().optional().nullable(),
  saved_address_id: z.string().optional().nullable(),
  same_as_event_address: z.boolean().optional(),
  save_address: z.boolean().optional(),
  save_address_label: z.string().optional().nullable(),
});

const ScheduleSchema = z.object({
  title: z.string().min(1),
  member_ids: z.array(z.string()).min(1),
  event: OccurrenceSchema,
  rehearsals: z.array(OccurrenceSchema).optional().default([]),
  save_event_address: z.boolean().optional(),
  save_event_address_label: z.string().optional().nullable(),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  return saasProxy(`/bands/${params.bandId}/schedules`, request);
}

export async function action({ request, params }: Route.ActionArgs) {
  return saasJsonAction(request, `/bands/${params.bandId}/schedules`, ScheduleSchema);
}
