import type { Route } from "./+types/songs.$songId.keys.$key.stems.$stemName.audio";
import { proxyBinary } from "../server/config.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  const key = encodeURIComponent(params.key);
  const stemName = encodeURIComponent(params.stemName);
  return proxyBinary(
    `/songs/${params.songId}/keys/${key}/stems/${stemName}/audio`,
    request,
  );
}
