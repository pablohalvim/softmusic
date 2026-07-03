import type { Route } from "./+types/songs.$songId";
import { errorResponse, proxyJson } from "../server/config.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return proxyJson(`/songs/${params.songId}`, undefined, request);
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === "DELETE") {
    return proxyJson(`/songs/${params.songId}`, { method: "DELETE" }, request);
  }
  return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
}
