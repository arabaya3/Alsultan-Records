"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Renders its (server-rendered) children everywhere except the home page, where the offer carousel takes their place. */
export function HideOnHome({ children }: { children: ReactNode }) {
  return usePathname() === "/" ? null : <>{children}</>;
}
