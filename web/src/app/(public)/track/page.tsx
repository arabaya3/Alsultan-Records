import { permanentRedirect } from "next/navigation";

// Request tracking was form-based; booking is now WhatsApp-only. The TrackForm code is kept
// (features/bookings/public) but no longer rendered. Old links land on the booking page.
export default function TrackPage() {
  permanentRedirect("/book");
}
