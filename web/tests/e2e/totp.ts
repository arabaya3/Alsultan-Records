import { createHmac } from "node:crypto";

/** RFC 4648 base32 decode (no padding required). */
export function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits), RFC 4226 dynamic truncation. */
export function totp(secret: string, timeMs = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** A code guaranteed not to be valid in the current/adjacent windows. */
export function wrongCode(secret: string): string {
  const valid = new Set([-1, 0, 1].map((d) => totp(secret, Date.now() + d * 30_000)));
  for (let i = 0; ; i++) {
    const c = String(i).padStart(6, "0");
    if (!valid.has(c)) return c;
  }
}

/** Avoids a code expiring mid-request: waits if fewer than 3 s remain in the window. */
export async function freshTotp(secret: string): Promise<string> {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 3000) await new Promise((r) => setTimeout(r, left + 200));
  return totp(secret);
}
