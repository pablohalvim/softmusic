import type { Route } from "./+types/songs.$songId.cancel";
import { errorResponse, proxyJson } from "../server/config.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }
  return proxyJson(`/songs/${params.songId}/cancel`, { method: "POST" }, request);
}
