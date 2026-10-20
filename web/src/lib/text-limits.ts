/**
 * Owner-written DESCRIPTIVE texts (descriptions, details, terms, intros, WhatsApp messages, gift and included-item
 * lines, internal notes) accept up to 10,000 characters — owner request 2026-10-20, enforced in the database by
 * migration 0024. Titles, slugs and short labels keep their own limits (layout).
 */
export const LONG_TEXT = 10_000;
export const LONG_TEXT_HINT = "حتى 10,000 حرف.";
