/**
 * Plain owner text → semantic blocks (paragraphs, numbered lists, bullet lists), for display only. The stored text is
 * never changed: every character of every line ends up in exactly one block, in the same order (list markers aside),
 * and nothing is rendered as HTML. Numbered lines ("1. …", "2) …") start an ordered item; "- …", "• …", "* …" lines are
 * bullets — right after a numbered item they become its sub-items (the owner's «1. تصوير السهرة ⏎ - كاميرا …» style).
 */
export type ListItem = { text: string; children: string[] };
export type TextBlock = { kind: "p"; lines: string[] } | { kind: "ol"; items: ListItem[] } | { kind: "ul"; items: string[] };

const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const BULLET = /^\s*[-•*]\s+(.*)$/;

export function parseTextBlocks(text: string | null | undefined): TextBlock[] {
  const blocks: TextBlock[] = [];
  const last = () => blocks[blocks.length - 1];
  let paraBreak = true;
  for (const raw of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      paraBreak = true;
      continue;
    }
    const n = line.match(NUMBERED);
    const b = n ? null : line.match(BULLET);
    const prev = last();
    if (n) {
      if (prev?.kind === "ol") prev.items.push({ text: n[2], children: [] });
      else blocks.push({ kind: "ol", items: [{ text: n[2], children: [] }] });
    } else if (b) {
      if (prev?.kind === "ol" && !paraBreak) prev.items[prev.items.length - 1].children.push(b[1]);
      else if (prev?.kind === "ul") prev.items.push(b[1]);
      else blocks.push({ kind: "ul", items: [b[1]] });
    } else if (prev?.kind === "p" && !paraBreak) prev.lines.push(line);
    else blocks.push({ kind: "p", lines: [line] });
    paraBreak = false;
  }
  return blocks;
}

/** A short preview for a card: the first `max` top-level list items (numbered titles or bullets) and how many more
 *  the full text has; null when the text has no list (then the caller shows clamped plain text). */
export function listPreview(text: string | null | undefined, max = 4): { items: string[]; more: number } | null {
  const blocks = parseTextBlocks(text);
  const all = blocks.flatMap((b) => (b.kind === "ol" ? b.items.map((i) => i.text) : b.kind === "ul" ? b.items : []));
  if (all.length < 2) return null;
  return { items: all.slice(0, max), more: Math.max(0, all.length - max) };
}
