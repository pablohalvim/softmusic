import type { Route } from "./+types/songs.$songId.job";
import { proxyJson } from "../server/config.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return proxyJson(`/songs/${params.songId}/job`, undefined, request);
}
