import "server-only";
import { ConfirmAction } from "@/features/portal/components/ConfirmAction";
import { createClient } from "@/lib/supabase/server";
import { customerSetConsent } from "./consent-actions";

/** Portal card: the customer's publication consent for one event (grant / withdraw). */
export async function PortalConsent({ eventId }: { eventId: string }) {
  const sb = await createClient();
  const { data: ev } = await sb
    .from("events")
    .select("publication_consent, is_published, consent_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev || ev.publication_consent === "none") return null;
  const granted = ev.publication_consent === "granted";
  return (
    <section aria-labelledby="consent-h" className="mt-6 border-t border-cream-line pt-5" data-testid="consent-card">
      <h3 id="consent-h" className="mb-2 text-base font-semibold">
        نشر أعمال مناسبتك
      </h3>
      <p className="mb-3 text-sm text-on-cream-muted" data-testid="consent-status">
        {granted
          ? ev.is_published
            ? "وافقت على عرض صور مختارة من مناسبتك في معرض أعمالنا، وهي منشورة حالياً."
            : "وافقت على عرض صور مختارة من مناسبتك في معرض أعمالنا."
          : ev.publication_consent === "revoked"
            ? "سحبت موافقتك على النشر. لا يُعرض شيء من مناسبتك للعامة."
            : "نطلب موافقتك على عرض صور مختارة من مناسبتك في معرض أعمالنا."}
      </p>
      {granted ? (
        <ConfirmAction
          label="سحب الموافقة على النشر"
          confirmText="ستختفي صور مناسبتك من الموقع فوراً وتُحذف النسخ المنشورة. صورك الخاصة تبقى كما هي. متابعة؟"
          doneText="سُحبت الموافقة. لم تعد مناسبتك معروضة للعامة."
          run={customerSetConsent.bind(null, eventId, "revoked")}
        />
      ) : (
        <ConfirmAction
          label="الموافقة على النشر"
          confirmText="توافق على عرض صور مختارة من مناسبتك في معرض أعمالنا؟ يمكنك سحب الموافقة في أي وقت."
          doneText="شكراً لك، سُجّلت موافقتك."
          run={customerSetConsent.bind(null, eventId, "granted")}
        />
      )}
    </section>
  );
}
