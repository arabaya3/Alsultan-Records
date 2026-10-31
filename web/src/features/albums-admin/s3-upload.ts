import { PARTS_PER_SIGN, partCount, partLength } from "@/lib/album-storage/multipart";

/**
 * Browser side of the multipart upload: parts go straight to S3 on short-lived URLs, several at once, each retried with
 * backoff. Resume needs nothing stored in the browser: the server lists what S3 already holds for this reservation.
 * Completion is decided by the server from S3's own part list, so S3 ETags are not read here.
 */
export const PART_CONCURRENCY = 4;
const RETRY_MS = [1000, 3000, 6000, 12000, 20000];

type Refused = { ok: false; denied?: boolean; message: string };
export type S3Start = { ok: true; partSize: number; parts: { n: number; size: number }[] } | Refused;
export type S3Sign = { ok: true; urls: { n: number; url: string }[] } | Refused;
export type PartSender = (url: string, body: Blob, signal: AbortSignal, onBytes: (sent: number) => void) => Promise<number>;
export type S3UploadDeps = {
  start: (photoId: string) => Promise<S3Start>;
  sign: (photoId: string, parts: number[]) => Promise<S3Sign>;
  send?: PartSender;
  wait?: (ms: number) => Promise<void>;
};
export class S3UploadDenied extends Error {}

const refused = (r: Refused) => (r.denied ? new S3UploadDenied(r.message) : new Error(r.message));

const xhrSend: PartSender = (url, body, signal, onBytes) =>
  new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    // Hetzner refuses a CORS preflight that names no request header, and a sliced Blob has no type of its own.
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => resolve(x.status);
    x.onerror = () => resolve(0);
    x.ontimeout = () => resolve(0);
    x.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", () => x.abort(), { once: true });
    if (signal.aborted) return x.abort();
    x.send(body);
  });

export async function uploadToS3(photoId: string, file: Blob, deps: S3UploadDeps, signal: AbortSignal, onProgress: (sent: number) => void): Promise<void> {
  const send = deps.send ?? xhrSend;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const st = await deps.start(photoId);
  if (!st.ok) throw refused(st);
  const { partSize } = st;
  const total = partCount(file.size, partSize);
  const stored = new Set(st.parts.filter((p) => p.size === partLength(file.size, partSize, p.n)).map((p) => p.n));
  const sent = new Map<number, number>();
  for (const n of stored) sent.set(n, partLength(file.size, partSize, n));
  const report = () => onProgress([...sent.values()].reduce((a, b) => a + b, 0));
  report();

  // One failed part fails the file straight away and stops its other parts; what S3 already holds is resumed later.
  const run = new AbortController();
  const stop = () => run.abort();
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) run.abort();

  const queue = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !stored.has(n));
  const urls = new Map<number, string>();
  const urlFor = async (n: number): Promise<string> => {
    const have = urls.get(n);
    if (have) return have;
    const batch = [n, ...queue.filter((m) => !urls.has(m)).slice(0, PARTS_PER_SIGN - 1)];
    const r = await deps.sign(photoId, batch);
    if (!r.ok) throw refused(r);
    for (const u of r.urls) urls.set(u.n, u.url);
    return urls.get(n)!;
  };

  const sendPart = async (n: number) => {
    const from = partSize * (n - 1);
    const body = file.slice(from, from + partLength(file.size, partSize, n));
    for (let attempt = 0; ; attempt++) {
      run.signal.throwIfAborted();
      const url = await urlFor(n);
      const status = await send(url, body, run.signal, (b) => {
        sent.set(n, b);
        report();
      });
      if (status >= 200 && status < 300) {
        sent.set(n, body.size);
        report();
        return;
      }
      sent.set(n, 0);
      report();
      // 403 is usually an expired URL: the next attempt signs again, and the server refuses if access was revoked.
      urls.delete(n);
      if (attempt >= RETRY_MS.length) throw new Error("part failed");
      await wait(RETRY_MS[attempt]);
    }
  };

  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) await sendPart(n);
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(PART_CONCURRENCY, queue.length) }, () =>
        worker().catch((e) => {
          run.abort();
          throw e;
        }),
      ),
    );
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
