/**
 * Direction for an isolated piece of owner text (<bdi>). A bare <bdi> is dir="auto": the FIRST strong character wins,
 * so «DJ وتنسيق الصوت» became an LTR run and read «وتنسيق الصوت DJ» in the RTL page. Text that contains any Arabic
 * letter is Arabic text with embedded Latin words → rtl; text without Arabic (an English title) keeps auto.
 */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function bidiDir(content: unknown): "rtl" | "auto" {
  return typeof content === "string" && ARABIC.test(content) ? "rtl" : "auto";
}
