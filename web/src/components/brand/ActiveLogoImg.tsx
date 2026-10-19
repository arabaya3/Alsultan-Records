"use client";

import { useState } from "react";

/** Active owner logo (/a/<id>). If it stops serving (rolled back while a page is cached), falls back to the built-in logo. */
export function ActiveLogoImg({ src, fallback, ...rest }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...rest} src={failed ? fallback : src} data-logo={failed ? "fallback" : "active"} onError={() => setFailed(true)} />
  );
}
