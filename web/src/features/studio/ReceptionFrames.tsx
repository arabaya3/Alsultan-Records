"use client";

import Link from "next/link";
import { useCallback, useRef } from "react";
import { useHotspot, useStudio } from "./StudioProvider";
import { useScrollFocus } from "./useScrollFocus";

export type ReceptionItem = { href: string; label: string; caption: string; image: string | null };

/**
 * The three prints hanging at the reception (Albums · Videos · Offers in the reference). Each is ONE real link:
 * over the 3D print on wide screens with the scene, a large tile everywhere else. The image is the same
 * same-origin thumbnail the print uses (one download, shared by the texture and the tile).
 */
function Frame({ item, index }: { item: ReceptionItem; index: number }) {
  const { attach, onPointerEnter, onPointerLeave, onFocus, onBlur, onClickCapture } = useHotspot(`reception:${index}`);
  return (
    <li ref={attach} data-hotspot={`reception:${index}`} className="studio-hotspot">
      <Link
        href={item.href}
        data-reception-frame={index}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        onClickCapture={onClickCapture}
        className="studio-hotspot__link group"
      >
        <span className="studio-hotspot__print">
          {item.image ? (
            // same-origin gated thumbnail (never an original); decorative — the link's name is the label below
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt="" decoding="async" loading="lazy" className="studio-hotspot__img" />
          ) : null}
        </span>
        <span className="studio-hotspot__label">
          <span className="studio-hotspot__title">{item.label}</span>
          <span className="studio-hotspot__caption">{item.caption}</span>
          <span aria-hidden="true" className="studio-hotspot__arrow">
            ←
          </span>
        </span>
      </Link>
    </li>
  );
}

export function ReceptionFrames({ items }: { items: ReceptionItem[] }) {
  const ctx = useStudio();
  const list = useRef<HTMLUListElement>(null);
  // phones: the print whose tile is in the middle of the screen is the one the camera looks at
  const onFocus = useCallback((i: number | null) => ctx?.focus(i === null ? null : `reception:${i}`), [ctx]);
  useScrollFocus(list, onFocus);
  return (
    <nav aria-label="زوايا الاستوديو" className="studio-reception-nav">
      <ul ref={list} className="studio-hotspots" data-studio-layer="">
        {items.map((it, i) => (
          <Frame key={it.href} item={it} index={i} />
        ))}
      </ul>
    </nav>
  );
}
