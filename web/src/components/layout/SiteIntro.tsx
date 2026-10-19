/**
 * One-time site opening (once per browser session): the ORIGINAL logo fades in with a gold ring moving around it
 * (the logo itself never rotates), «فرحتك إلها حكاية.» rises, then a circular aperture opens from the centre and
 * reveals the page, which has been loading behind it the whole time. Total ≤ 2 s, no sound, no flash.
 *
 * - Pure CSS animation (globals.css, `[data-site-intro]`); it only runs while <html data-site-intro="on">.
 * - The inline script runs during HTML parsing, before first paint: it turns the intro on only if it has not played
 *   in this session and the visitor does not prefer reduced motion, records it in sessionStorage immediately (so
 *   navigation and reload never replay it), wires «تخطّي» natively (works before hydration) and always removes the
 *   attribute after the animation — the overlay can never stay up, lock scrolling or block clicks.
 * - Without JS, with reduced motion, or after it has played: the overlay is display:none.
 */
const ARM = `(function(){var d=document.documentElement;try{var k="sultan-intro-v1";if(sessionStorage.getItem(k)||matchMedia("(prefers-reduced-motion: reduce)").matches)return;sessionStorage.setItem(k,"1")}catch(e){return}d.setAttribute("data-site-intro","on");var t,end=function(){clearTimeout(t);d.removeAttribute("data-site-intro")};var b=document.getElementById("site-intro-skip");if(b)b.addEventListener("click",end);t=setTimeout(end,2050)})();`;

export function SiteIntro() {
  return (
    <>
      <div data-site-intro="" className="site-intro">
        <div className="site-intro__aperture" />
        <div className="site-intro__brand" aria-hidden="true">
          <div className="site-intro__emblem">
            <span className="site-intro__ring" />
            {/* eslint-disable-next-line @next/next/no-img-element -- original logo file, decorative, preloaded by the header */}
            <img src="/brand/logo-main.webp" alt="" width={146} height={121} decoding="async" />
          </div>
          <p className="site-intro__tagline">
            فرحتك إلها حكاية<span className="text-gold">.</span>
          </p>
        </div>
        <button id="site-intro-skip" type="button" className="site-intro__skip">
          تخطّي
        </button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: ARM }} />
    </>
  );
}
