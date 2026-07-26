import { z } from "zod";
import type { Route } from "./+types/bands.$bandId.schedules.occurrences.$occurrenceId";
import { saasJsonAction } from "../server/saas-routes.server";

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
});

export async function action({ request, params }: Route.ActionArgs) {
  return saasJsonAction(
    request,
    `/bands/${params.bandId}/schedules/occurrences/${params.occurrenceId}`,
    UpdateOccurrenceSchema,
    "PATCH",
  );
}
