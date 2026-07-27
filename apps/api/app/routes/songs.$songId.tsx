import { z } from "zod";
import type { Route } from "./+types/songs.$songId";
import { errorResponse, proxyJson } from "../server/config.server";
import { saasDeleteAction, saasJsonAction } from "../server/saas-routes.server";

const UpdateSongSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().max(200).nullable().optional(),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  return proxyJson(`/songs/${params.songId}`, undefined, request);
}

export async function action({ request, params }: Route.ActionArgs) {
  const path = `/songs/${params.songId}`;
  if (request.method === "DELETE") {
    return saasDeleteAction(request, path);
  }
  if (request.method === "PATCH") {
    return saasJsonAction(request, path, UpdateSongSchema, "PATCH");
  }
  return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
}
