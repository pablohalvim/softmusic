import type { Route } from "./+types/songs.$songId.stems.$stemName.audio";
import { proxyBinary } from "../server/config.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  return proxyBinary(`/songs/${params.songId}/stems/${params.stemName}/audio`, request);
}
