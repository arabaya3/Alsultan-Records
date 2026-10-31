/**
 * Connection check for the album bucket. Touches only a unique test prefix, which it deletes again; never changes the
 * bucket's privacy and never reads real files. Prints no keys, no URLs with signatures.
 *
 *   node scripts/s3-check.mjs                 # credentials from the environment
 *   S3_ENV_FILE=<path> node scripts/s3-check.mjs
 *   node scripts/s3-check.mjs --apply-cors https://example.com,http://localhost:3000   # also set CORS + abort rule
 */
import fs from "node:fs";
import crypto from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const env = { ...process.env };
if (process.env.S3_ENV_FILE) {
  for (const l of fs.readFileSync(process.env.S3_ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = /^(S3_[A-Z_]+)=(.*)$/.exec(l);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
for (const k of ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) if (!env[k]) throw new Error(`missing ${k}`);
const Bucket = env.S3_BUCKET;
const pathStyle = env.S3_FORCE_PATH_STYLE === "1";
const client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: pathStyle,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const u = new URL(env.S3_ENDPOINT);
const base = pathStyle ? `${u.origin}/${Bucket}` : `${u.protocol}//${Bucket}.${u.host}`;
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
let bad = 0;
const check = (name, pass, note = "") => {
  if (!pass) bad++;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${note ? ` (${note})` : ""}`);
};

const prefix = `__connection-test/${crypto.randomUUID()}/`;
await client.send(new HeadBucketCommand({ Bucket }));
check("bucket reachable with the keys", true);
check("anonymous listing refused", [401, 403].includes((await fetch(`${base}/?list-type=2`)).status));

const key = `${prefix}probe.bin`;
const body = crypto.randomBytes(64 * 1024);
try {
  await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: "application/octet-stream" }));
  const got = Buffer.from(await (await client.send(new GetObjectCommand({ Bucket, Key: key }))).Body.transformToByteArray());
  check("write then read back identical", sha(got) === sha(body));
  check("anonymous read of the object refused", [401, 403].includes((await fetch(`${base}/${key}`)).status));
  const signed = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: 60 });
  check("short-lived read URL works", (await fetch(signed)).status === 200);

  // Multipart through presigned URLs, exactly what the browser does: the length is part of the signature.
  const mpKey = `${prefix}multipart.bin`;
  const partSize = 5 * 1024 * 1024;
  const whole = Buffer.concat([crypto.randomBytes(partSize), crypto.randomBytes(1024)]);
  const { UploadId } = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: mpKey, ContentType: "application/octet-stream" }));
  try {
    const sign = (n, length) =>
      getSignedUrl(client, new UploadPartCommand({ Bucket, Key: mpKey, UploadId, PartNumber: n, ContentLength: length }), { expiresIn: 300, signableHeaders: new Set(["content-length"]) });
    const r1 = await fetch(await sign(1, partSize), { method: "PUT", body: whole.subarray(0, partSize) });
    const r2 = await fetch(await sign(2, 1024), { method: "PUT", body: whole.subarray(partSize) });
    check("presigned parts accepted", r1.ok && r2.ok, `${r1.status}/${r2.status}`);
    const wrong = await fetch(await sign(2, 1024), { method: "PUT", body: whole.subarray(partSize, partSize + 512) });
    check("presigned part with another length refused", !wrong.ok, String(wrong.status));
    const parts = (await client.send(new ListPartsCommand({ Bucket, Key: mpKey, UploadId }))).Parts ?? [];
    check("server lists the stored parts", parts.length === 2);
    await client.send(new CompleteMultipartUploadCommand({ Bucket, Key: mpKey, UploadId, MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })) } }));
    const out = Buffer.from(await (await client.send(new GetObjectCommand({ Bucket, Key: mpKey }))).Body.transformToByteArray());
    check("multipart object identical", sha(out) === sha(whole));
  } catch (e) {
    await client.send(new AbortMultipartUploadCommand({ Bucket, Key: mpKey, UploadId })).catch(() => {});
    throw e;
  }
} finally {
  const left = (await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }))).Contents ?? [];
  for (const o of left) await client.send(new DeleteObjectCommand({ Bucket, Key: o.Key }));
  const after = (await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }))).Contents ?? [];
  check("test files removed", after.length === 0);
}

const i = process.argv.indexOf("--apply-cors");
if (i >= 0) {
  const origins = String(process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origins.length || origins.includes("*")) throw new Error("name the exact origins");
  // PUT only: previews are plain <img> requests, and parts need no readable response headers.
  await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ["PUT"], AllowedHeaders: ["content-type"], MaxAgeSeconds: 3600 }] } }));
  await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket, LifecycleConfiguration: { Rules: [{ ID: "abort-unfinished-uploads", Status: "Enabled", Filter: { Prefix: "" }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }] } }));
  console.log(`CORS set for ${origins.length} origin(s); unfinished uploads are dropped after 7 days`);
}
try {
  const cors = await client.send(new GetBucketCorsCommand({ Bucket }));
  console.log("current CORS:", JSON.stringify(cors.CORSRules));
} catch {
  console.log("current CORS: none");
}
process.exit(bad ? 1 : 0);
