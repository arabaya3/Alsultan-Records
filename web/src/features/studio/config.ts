import { STATION_RULES } from "./stations";

/**
 * Central switch for the immersive studio: NEXT_PUBLIC_STUDIO=off restores the classic public pages everywhere
 * (same routes, same content, no scene, the original opening animation). Anything else = on.
 */
export const STUDIO_ENABLED = process.env.NEXT_PUBLIC_STUDIO !== "off";

/** Visitor preference ("عرض مبسّط"): stored per browser, read before first paint. */
export const STUDIO_PREF_KEY = "sultan-studio";
/** The calm approach to the reception plays once per browser session. */
export const STUDIO_ENTRY_KEY = "sultan-studio-entry";

/**
 * Runs during HTML parsing, before first paint, so the layout never jumps:
 *   html[data-studio]         = "scene" (WebGL present, no data-saver / tiny memory / stored opt-out) | "static"
 *   html[data-studio-station] = the corner for this URL (same rules as stationFor), absent on reading pages
 * The scene itself loads later; "scene" only reserves its layout. If it then fails, the page switches to "static".
 * Without JS neither attribute is set and the static layout applies.
 */
export const STUDIO_BOOT = `(function(){var d=document.documentElement;try{var p=location.pathname,q=new URLSearchParams(location.search),R=${JSON.stringify(
  STATION_RULES,
)},s=null;for(var i=0;i<R.length;i++){if(new RegExp(R[i][0]).test(p)){s=R[i][1];if(s==="work")s=q.get("tab")==="photos"?"albums":"videos";break}}if(s)d.setAttribute("data-studio-station",s);var m="scene",n=navigator;if(!window.WebGLRenderingContext)m="static";if(n.connection&&n.connection.saveData)m="static";if(n.deviceMemory&&n.deviceMemory<2)m="static";try{if(localStorage.getItem("${STUDIO_PREF_KEY}")==="static")m="static"}catch(e){}d.setAttribute("data-studio",m)}catch(e){d.setAttribute("data-studio","static")}})();`;
