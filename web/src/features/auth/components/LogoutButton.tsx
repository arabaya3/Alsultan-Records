"use client";

import { useState } from "react";
import { signOut } from "@/features/auth/actions";

/** Signs out server-side (clears auth cookies), then hard-navigates so all client state and router cache are discarded. */
export function LogoutButton({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      className={className}
      onClick={async () => {
        setPending(true);
        await signOut().catch(() => null);
        try {
          sessionStorage.clear();
        } catch {
          /* storage may be unavailable */
        }
        window.location.replace("/login?signed_out=1");
      }}
    >
      {pending ? "جارِ الخروج…" : "تسجيل الخروج"}
    </button>
  );
}
