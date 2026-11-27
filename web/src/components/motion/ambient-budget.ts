/**
 * Budget for decorative, self-advancing photos (home hero slideshow, inner-page rotating backdrop). Every step loads a
 * new photo through /p (a function call, two database reads and a storage request), so a step is only taken while
 * someone can actually see it:
 *   - motion allowed (prefers-reduced-motion) and the visitor did not ask to save data (Save-Data);
 *   - the tab is visible and the photo area is on screen;
 *   - the visitor did something (pointer, key, wheel, touch, scroll) within the last AMBIENT_IDLE_STEPS steps.
 * Any activity resets the idle count, so a person watching keeps the full slideshow; a page left open stops loading.
 */
export const AMBIENT_IDLE_STEPS = 40;

export type AmbientState = {
  reducedMotion: boolean;
  hidden: boolean;
  inView: boolean;
  saveData: boolean;
  /** Steps taken since the visitor's last activity. */
  idleSteps: number;
};

export function ambientMayAdvance(s: AmbientState): boolean {
  return !s.reducedMotion && !s.hidden && s.inView && !s.saveData && s.idleSteps < AMBIENT_IDLE_STEPS;
}
