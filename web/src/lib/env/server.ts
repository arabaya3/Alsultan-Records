import "server-only";
import { z } from "zod";
import { publicEnv, type PublicEnv } from "./public";

/** Server-only environment. Importing this from a client component fails the build. */
const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  /** HMAC key used to hash client IPs before they reach the database (rate limits). */
  IP_HASH_SECRET: z.string().min(32).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema> & PublicEnv;

const parsed = serverSchema.safeParse({
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || undefined,
  IP_HASH_SECRET: process.env.IP_HASH_SECRET || undefined,
});

if (!parsed.success) {
  throw new Error(
    `Invalid server environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
  );
}

export const serverEnv: ServerEnv = { ...publicEnv, ...parsed.data };
