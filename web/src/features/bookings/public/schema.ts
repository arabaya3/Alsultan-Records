import { z } from "zod";

export const EVENT_TYPES = [
  "wedding",
  "engagement",
  "graduation",
  "festival",
  "commercial",
  "dj",
  "livestream",
  "production",
] as const;

export const SERVICE_OPTIONS = [
  { value: "photo", label: "تصوير فوتوغرافي" },
  { value: "film", label: "فيلم" },
  { value: "dj", label: "DJ" },
  { value: "livestream", label: "بث مباشر" },
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "النص أطول من المسموح")
    .optional()
    .transform((v) => (v ? v : null));

export const bookingSchema = z.object({
  contact_name: z.string().trim().min(2, "اكتب اسمك").max(80, "الاسم أطول من المسموح"),
  contact_phone: z
    .string()
    .trim()
    .max(25, "رقم الهاتف غير صحيح")
    .refine((v) => v.replace(/\D/g, "").length >= 7, "اكتب رقم هاتف صحيح"),
  event_type: z.enum(EVENT_TYPES, { error: "اختر نوع المناسبة" }),
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "اختر تاريخ المناسبة"),
  contact_email: z
    .union([z.literal(""), z.email("البريد الإلكتروني غير صحيح")])
    .optional()
    .transform((v) => (v ? v : null)),
  city: optionalText(80),
  venue: optionalText(120),
  guests: z
    .union([z.literal(""), z.coerce.number().int().min(1, "عدد غير صحيح").max(5000, "عدد غير صحيح")])
    .optional()
    .transform((v) => (typeof v === "number" ? v : null)),
  services: z.array(z.enum(SERVICE_OPTIONS.map((s) => s.value) as [string, ...string[]])).max(10).default([]),
  message: optionalText(1000),
});

export type BookingInput = z.infer<typeof bookingSchema>;

export type FieldErrors = Partial<Record<keyof BookingInput, string>>;

export type BookingState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: FieldErrors }
  | { status: "success"; trackingCode: string };

export const trackSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{6,20}$/, "رمز المتابعة غير صحيح"),
  last4: z.string().trim().regex(/^\d{4}$/, "اكتب آخر أربعة أرقام من هاتفك"),
});

export type TrackState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "not_found" }
  | { status: "found"; bookingStatus: string; eventDate: string | null; updatedAt: string | null };
