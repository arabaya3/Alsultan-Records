import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { s3Download, s3Head, s3Put, s3Remove, s3SignedGet } from "./s3";

const BUCKET = "album-media";
export type AlbumProvider = "supabase" | "s3";

/** One album object store. A row's `storage_provider` picks it: never assume an older file has moved. */
export type AlbumStore = {
  head(path: string): Promise<{ size: number } | null>;
  download(path: string): Promise<Buffer | null>;
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  signedGet(paths: string[], seconds: number): Promise<Map<string, string>>;
};

const s3Store: AlbumStore = {
  head: s3Head,
  download: s3Download,
  put: s3Put,
  remove: s3Remove,
  async signedGet(paths, seconds) {
    return new Map(await Promise.all(paths.map(async (p) => [p, await s3SignedGet(p, seconds)] as const)));
  },
};

/** `sb` keeps today's access rules on Supabase: the caller's client for admin actions, the service role for workers. */
function supabaseStore(sb: SupabaseClient): AlbumStore {
  const bucket = () => sb.storage.from(BUCKET);
  return {
    async head(path) {
      const { data } = await bucket().info(path);
      return data ? { size: Number((data as { size?: number }).size ?? -1) } : null;
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      return error || !data ? null : Buffer.from(await data.arrayBuffer());
    },
    async put(path, body, contentType) {
      const { error } = await bucket().upload(path, body, { contentType, upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(error.message);
    },
    async remove(paths) {
      const { error } = await bucket().remove(paths);
      if (error) throw new Error(error.message);
    },
    async signedGet(paths, seconds) {
      const { data } = await bucket().createSignedUrls(paths, seconds);
      return new Map((data ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl as string]));
    },
  };
}

export function albumStore(provider: string | null | undefined, sb: SupabaseClient): AlbumStore {
  return provider === "s3" ? s3Store : supabaseStore(sb);
}
