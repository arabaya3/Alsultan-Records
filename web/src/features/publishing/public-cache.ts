import "server-only";
import { updateTag } from "next/cache";
import { TAGS } from "@/lib/cache-tags";
import { expireAgainAfterSettling } from "@/lib/expire-after-settling";

/**
 * A change to what visitors may see of a project (event) or of its published photos has been SAVED: expire the public
 * reads that carry it — the /work «مشاريع مختارة» list, each project page, the sitemap, the hero media and service
 * covers (TAGS.projects, TAGS.media).
 *
 * Call it from a Server Action, once, after the last write of the change has succeeded — never before a write (a
 * visitor's render in between would cache the old state for a day) and never when nothing changed.
 *
 * Two steps, both needed:
 *   - updateTag: the next request re-reads instead of being served the cached page (public reads last a day);
 *   - the same tags once more a few seconds later: a visitor's render that read the old rows before this save and
 *     finishes after it would otherwise store its page as if it were fresh (see expire-after-settling.ts).
 *
 * This is only about cached PAGES. The image bytes are never cached publicly: /m/<id>/<variant> checks the row and the
 * storage policy on every request, so a withdrawn or unpublished photo is 404 from the next request whatever a page
 * still says.
 */
export function expirePublicProjects(): void {
  updateTag(TAGS.projects);
  updateTag(TAGS.media);
  expireAgainAfterSettling(TAGS.projects, TAGS.media);
}
