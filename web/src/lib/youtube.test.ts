import { describe, expect, it } from "vitest";
import { parseYouTubeId } from "./youtube";

describe("parseYouTubeId", () => {
  it.each([
    ["y0-ajKb7Umw", "y0-ajKb7Umw"],
    ["https://www.youtube.com/watch?v=y0-ajKb7Umw&t=10s", "y0-ajKb7Umw"],
    ["https://youtu.be/y0-ajKb7Umw?si=abc", "y0-ajKb7Umw"],
    ["https://youtube.com/shorts/y0-ajKb7Umw", "y0-ajKb7Umw"],
    ["https://m.youtube.com/watch?v=y0-ajKb7Umw", "y0-ajKb7Umw"],
    ["https://www.youtube-nocookie.com/embed/y0-ajKb7Umw", "y0-ajKb7Umw"],
  ])("accepts %s", (input, id) => expect(parseYouTubeId(input)).toBe(id));
  it.each([
    "https://evil.example/watch?v=y0-ajKb7Umw",
    "https://youtube.com.evil.example/watch?v=y0-ajKb7Umw",
    '<iframe src="https://www.youtube.com/embed/y0-ajKb7Umw"></iframe>',
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/channel/UCpxtdVABBIOaNLne-0_dDmQ",
  ])("rejects %s", (input) => expect(parseYouTubeId(input)).toBeNull());
});
