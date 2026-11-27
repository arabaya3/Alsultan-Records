import { describe, expect, it } from "vitest";
import { AMBIENT_IDLE_STEPS, ambientMayAdvance, type AmbientState } from "./ambient-budget";

const on: AmbientState = { reducedMotion: false, hidden: false, inView: true, saveData: false, idleSteps: 0 };

describe("ambientMayAdvance", () => {
  it("advances while visible, in view, motion allowed and the visitor has not been idle too long", () => {
    expect(ambientMayAdvance(on)).toBe(true);
    expect(ambientMayAdvance({ ...on, idleSteps: AMBIENT_IDLE_STEPS - 1 })).toBe(true);
  });

  it("stops under reduced motion, in a hidden tab, out of view, or with Save-Data", () => {
    expect(ambientMayAdvance({ ...on, reducedMotion: true })).toBe(false);
    expect(ambientMayAdvance({ ...on, hidden: true })).toBe(false);
    expect(ambientMayAdvance({ ...on, inView: false })).toBe(false);
    expect(ambientMayAdvance({ ...on, saveData: true })).toBe(false);
  });

  it("stops after the idle budget of steps without any visitor activity", () => {
    expect(ambientMayAdvance({ ...on, idleSteps: AMBIENT_IDLE_STEPS })).toBe(false);
    expect(ambientMayAdvance({ ...on, idleSteps: AMBIENT_IDLE_STEPS + 5 })).toBe(false);
  });

  it("keeps the idle budget at several minutes of photos (owner's slideshow still plays for a real viewer)", () => {
    // 7 s per hero photo → at least 4 minutes before an untouched page stops loading new photos.
    expect(AMBIENT_IDLE_STEPS * 7).toBeGreaterThanOrEqual(240);
  });
});
