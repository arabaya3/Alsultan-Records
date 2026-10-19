import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Layout";

export default function PortalNotFound() {
  return (
    <Container className="py-20 text-center">
      <h1 className="text-3xl font-bold" data-testid="portal-not-found">
        لم نجد هذه الصفحة<span className="text-gold">.</span>
      </h1>
      <p className="mx-auto mt-3 max-w-md text-on-cream-muted">
        قد يكون الرابط غير صحيح، أو أن هذه المناسبة غير مرتبطة بحسابك.
      </p>
      <div className="mt-8 flex justify-center">
        <ButtonLink href="/portal">العودة إلى مناسباتي</ButtonLink>
      </div>
    </Container>
  );
}
