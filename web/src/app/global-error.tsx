"use client";

/**
 * Last-resort error page for a failure in the root layout itself (app/error.tsx covers everything below it). It replaces
 * the root layout, so it carries its own document, direction and minimal inline styles (global CSS is not loaded here).
 * Same words as app/error.tsx; colours are the tokens in styles/tokens.css + globals.css (night, ivory, gold). The
 * server side of the error is logged by instrumentation.ts.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0e1322", color: "#f5f1e8", fontFamily: "system-ui, sans-serif" }}>
        <title>خلل مؤقت</title>
        <main style={{ maxWidth: "32rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "2rem", margin: 0 }}>صار خلل مؤقت.</h1>
          <p style={{ marginTop: "1rem", fontSize: "1.125rem", opacity: 0.85 }}>ما قدرنا نعرض الصفحة هلّق. جرّب مرة ثانية بعد لحظات.</p>
          <div style={{ marginTop: "2rem", display: "flex", gap: "2rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{ minHeight: "3rem", padding: "0 2rem", border: 0, borderRadius: 2, background: "#e9b949", color: "#0e1322", fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}
            >
              حاول مرة ثانية
            </button>
            {/* A plain link on purpose: the app's router may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ minHeight: "2.75rem", display: "inline-flex", alignItems: "center", color: "inherit" }}>
              الرئيسية
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
