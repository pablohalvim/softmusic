import type { Route } from "./+types/songs.$songId.stems";
import { proxyJson } from "../server/config.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return proxyJson(`/songs/${params.songId}/stems`, undefined, request);
}
