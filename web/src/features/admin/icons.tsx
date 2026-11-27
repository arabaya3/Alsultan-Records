/** Small stroke icons for the admin (decorative: always aria-hidden). 1.8px stroke, currentColor. */
import type { ReactNode } from "react";

function I({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
type P = { size?: number };

export const IconEdit = (p: P) => <I {...p}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></I>;
export const IconStar = (p: P) => <I {...p}><path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8Z" /></I>;
export const IconEyeOff = (p: P) => <I {...p}><path d="M3 3l18 18" /><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a15 15 0 0 1-3 3.5M6.6 6.6C4.6 8 3.2 10 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></I>;
export const IconEye = (p: P) => <I {...p}><path d="M2.5 12C3.5 10.5 7 6 12 6s8.5 4.5 9.5 6c-1 1.5-4.5 6-9.5 6s-8.5-4.5-9.5-6Z" /><circle cx="12" cy="12" r="3" /></I>;
export const IconPin = (p: P) => <I {...p}><path d="M9 3h6l-1 6 4 4H6l4-4-1-6Z" /><path d="M12 13v8" /></I>;
export const IconTrash = (p: P) => <I {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></I>;
export const IconCopy = (p: P) => <I {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></I>;
export const IconLink = (p: P) => <I {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></I>;
export const IconCalendar = (p: P) => <I {...p}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></I>;
export const IconPlus = (p: P) => <I {...p}><path d="M12 5v14M5 12h14" /></I>;
export const IconImage = (p: P) => <I {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 4 4 3-3 4 4" /></I>;
export const IconFolder = (p: P) => <I {...p}><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" /></I>;
export const IconArchive = (p: P) => <I {...p}><rect x="3.5" y="4" width="17" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></I>;
export const IconLayers = (p: P) => <I {...p}><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></I>;
export const IconGear = (p: P) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></I>;
export const IconUser = (p: P) => <I {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></I>;
export const IconUsers = (p: P) => <I {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></I>;
export const IconFacebook = (p: P) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M13.5 21v-7h2.5l.5-3h-3V9.5c0-.9.4-1.5 1.6-1.5H16.5V5.3A17 17 0 0 0 14.3 5c-2.3 0-3.8 1.4-3.8 3.9V11H8v3h2.5v7" /></I>;
export const IconDatabase = (p: P) => <I {...p}><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" /><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" /></I>;
export const IconStore = (p: P) => <I {...p}><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /><path d="M5 11v9h14v-9M10 20v-5h4v5" /></I>;
export const IconVideo = (p: P) => <I {...p}><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="m10 9.5 5 2.5-5 2.5Z" /></I>;
export const IconTag = (p: P) => <I {...p}><path d="M3 12V4h8l10 10-8 8Z" /><circle cx="7.5" cy="8.5" r="1.4" /></I>;
export const IconDiamond = (p: P) => <I {...p}><path d="M6 4h12l3 5-9 11L3 9Z" /><path d="M3 9h18M9 4l3 16 3-16" /></I>;
export const IconPhone = (p: P) => <I {...p}><path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></I>;
export const IconMail = (p: P) => <I {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></I>;
export const IconPinMap = (p: P) => <I {...p}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></I>;
export const IconLock = (p: P) => <I {...p}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></I>;
export const IconUpload = (p: P) => <I {...p}><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></I>;
export const IconSave = (p: P) => <I {...p}><path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></I>;
export const IconList = (p: P) => <I {...p}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></I>;
export const IconNote = (p: P) => <I {...p}><path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20Z" /><path d="M14 3.5V8h4M9 12h6M9 16h4" /></I>;
export const IconChevronDown = (p: P) => <I {...p}><path d="m6 9 6 6 6-6" /></I>;
export const IconMonitor = (p: P) => <I {...p}><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></I>;
export const IconGrid = (p: P) => <I {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></I>;
export const IconCheck = (p: P) => <I {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></I>;
export const IconClock = (p: P) => <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></I>;
export const IconInfo = (p: P) => <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></I>;
