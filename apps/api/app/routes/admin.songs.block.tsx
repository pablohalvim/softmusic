import { z } from "zod";
import type { Route } from "./+types/admin.songs.block";
import { saasJsonAction } from "../server/saas-routes.server";

const BlockSchema = z.object({
  song_id: z.string().optional(),
  youtube_video_id: z.string().optional(),
  reason: z.string().min(1),
});

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/admin/songs/block", BlockSchema);
}
