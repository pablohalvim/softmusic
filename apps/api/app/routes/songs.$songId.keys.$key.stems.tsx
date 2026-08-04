import type { Route } from "./+types/songs.$songId.keys.$key.stems";
import { proxyJson } from "../server/config.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const key = encodeURIComponent(params.key);
  return proxyJson(`/songs/${params.songId}/keys/${key}/stems`, undefined, request);
}
