import { z } from "zod";
import type { Route } from "./+types/bands.$bandId.schedules.occurrences.$occurrenceId";
import { saasJsonAction } from "../server/saas-routes.server";

const MemberSelectionSchema = z.object({
  member_id: z.string().min(1),
  role_ids: z.array(z.string()).default([]),
});

const ScheduleSongSchema = z.object({
  song_id: z.string().min(1),
  musical_key: z.string().max(16).optional().default(""),
});

const UpdateOccurrenceSchema = z.object({
  title: z.string().optional().nullable(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  formatted_address: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  place_id: z.string().optional().nullable(),
  saved_address_id: z.string().optional().nullable(),
  member_ids: z.array(z.string()).optional(),
  members: z.array(MemberSelectionSchema).optional(),
  songs: z.array(ScheduleSongSchema).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  return saasJsonAction(
    request,
    `/bands/${params.bandId}/schedules/occurrences/${params.occurrenceId}`,
    UpdateOccurrenceSchema,
    "PATCH",
  );
}
