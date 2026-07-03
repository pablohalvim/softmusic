import type { Route } from "./+types/songs.$songId.timeline";
import { proxyJson } from "../server/config.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return proxyJson(`/songs/${params.songId}/timeline`, undefined, request);
}
