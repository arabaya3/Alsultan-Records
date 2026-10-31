import "server-only";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StoredPart } from "./multipart";

/**
 * Album objects on an S3-compatible store (Hetzner Object Storage). Server only: the keys come from server env and
 * never reach the browser, which only ever gets short-lived URLs for one part of one reserved object. The bucket stays
 * private. Object keys are the same paths the database stores (albums/<album>/<photo>/...).
 */
const SIGN_PART_SECONDS = 15 * 60;
const CALL_DEADLINE_MS = 30_000;

export type S3Env = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };

export function s3Env(env: Record<string, string | undefined> = process.env): S3Env | null {
  const { S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle: env.S3_FORCE_PATH_STYLE === "1" };
}

/** Where new album uploads go. Unset = Supabase, so deploying this code changes nothing until it is switched on. */
export function albumWriteProvider(): "supabase" | "s3" | "misconfigured" {
  if (process.env.ALBUM_STORAGE_WRITE !== "s3") return "supabase";
  return s3Env() ? "s3" : "misconfigured";
}

let cached: { client: S3Client; bucket: string } | null = null;
function s3(): { client: S3Client; bucket: string } {
  if (cached) return cached;
  const c = s3Env();
  if (!c) throw new Error("S3 is not configured");
  const client = new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      forcePathStyle: c.forcePathStyle,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      // The SDK's default CRC32 checksums are not understood by every S3-compatible store and break presigned parts.
      // A store that stops answering must fail the call, not hold a function until Vercel kills it.
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 20_000 },
      maxAttempts: 2,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
  });
  // A store that accepts the connection and then goes silent is only caught by a deadline on the whole call.
  const send = client.send.bind(client) as (cmd: unknown, opts?: { abortSignal?: AbortSignal }) => Promise<unknown>;
  (client as unknown as { send: typeof send }).send = (cmd, opts) => send(cmd, { ...opts, abortSignal: opts?.abortSignal ?? AbortSignal.timeout(CALL_DEADLINE_MS) });
  cached = { bucket: c.bucket, client };
  return cached;
}

const status = (e: unknown) => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const named = (e: unknown, ...names: string[]) => names.includes((e as { name?: string })?.name ?? "");
const isMissing = (e: unknown) => status(e) === 404 || named(e, "NotFound", "NoSuchKey", "NoSuchUpload");

export async function s3Head(key: string): Promise<{ size: number } | null> {
  const { client, bucket } = s3();
  try {
    const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: Number(r.ContentLength ?? -1) };
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

export async function s3Download(key: string): Promise<Buffer | null> {
  const { client, bucket } = s3();
  try {
    const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

export async function s3Put(key: string, body: Buffer, contentType: string): Promise<void> {
  const { client, bucket } = s3();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

/** Deleting an absent object is not an error, which is the desired end state. */
export async function s3Remove(keys: string[]): Promise<void> {
  const { client, bucket } = s3();
  for (const key of keys) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export type S3Read =
  | { kind: "ok"; body: ReadableStream; contentType?: string; contentLength?: number; etag?: string; lastModified?: Date }
  | { kind: "not-modified"; etag?: string }
  | { kind: "missing" };

/** Streamed read for the public route. Storage errors and timeouts are thrown: only a missing object means "missing". */
export async function s3Read(key: string, opts: { ifNoneMatch?: string | null; signal?: AbortSignal }): Promise<S3Read> {
  const { client, bucket } = s3();
  try {
    const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, IfNoneMatch: opts.ifNoneMatch ?? undefined }), { abortSignal: opts.signal });
    if (!r.Body) return { kind: "missing" };
    return { kind: "ok", body: r.Body.transformToWebStream(), contentType: r.ContentType, contentLength: r.ContentLength, etag: r.ETag, lastModified: r.LastModified };
  } catch (e) {
    if (status(e) === 304 || named(e, "NotModified", "304")) return { kind: "not-modified", etag: opts.ifNoneMatch ?? undefined };
    if (isMissing(e)) return { kind: "missing" };
    throw e;
  }
}

export async function s3SignedGet(key: string, seconds: number): Promise<string> {
  const { client, bucket } = s3();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: seconds });
}

/** Every object under a prefix, one page at a time (backup manifest). */
export async function* s3List(prefix = ""): AsyncGenerator<{ path: string; size: number | null; updated_at: string | null }> {
  const { client, bucket } = s3();
  for (let token: string | undefined; ; ) {
    const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) yield { path: String(o.Key), size: o.Size ?? null, updated_at: o.LastModified?.toISOString() ?? null };
    if (!r.IsTruncated) return;
    token = r.NextContinuationToken;
  }
}

// ------------------------------------------------------------------ multipart
export async function s3MultipartCreate(key: string, contentType: string): Promise<string> {
  const { client, bucket } = s3();
  const r = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
  if (!r.UploadId) throw new Error("no upload id");
  return r.UploadId;
}

/** Stored parts, or null when the upload no longer exists (finished, aborted or expired). */
export async function s3MultipartParts(key: string, uploadId: string): Promise<(StoredPart & { etag: string })[] | null> {
  const { client, bucket } = s3();
  const out: (StoredPart & { etag: string })[] = [];
  try {
    for (let marker: string | undefined; ; ) {
      const r = await client.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
      for (const p of r.Parts ?? []) out.push({ n: Number(p.PartNumber), size: Number(p.Size), etag: String(p.ETag) });
      if (!r.IsTruncated) return out;
      marker = r.NextPartNumberMarker;
    }
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

/** The URL only accepts this part of this upload, with exactly this length. */
export async function s3SignPart(key: string, uploadId: string, n: number, length: number): Promise<string> {
  const { client, bucket } = s3();
  return getSignedUrl(client, new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: n, ContentLength: length }), {
    expiresIn: SIGN_PART_SECONDS,
    signableHeaders: new Set(["content-length"]),
  });
}

export async function s3MultipartComplete(key: string, uploadId: string, parts: (StoredPart & { etag: string })[]): Promise<void> {
  const { client, bucket } = s3();
  const sorted = [...parts].sort((a, b) => a.n - b.n);
  await client.send(
    new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: sorted.map((p) => ({ PartNumber: p.n, ETag: p.etag })) } }),
  );
}

export async function s3MultipartAbort(key: string, uploadId: string): Promise<void> {
  const { client, bucket } = s3();
  try {
    await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
}
