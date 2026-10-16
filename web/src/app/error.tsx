"use client";

import Link from "next/link";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="grid flex-1 place-items-center bg-ink px-[var(--gutter)] py-20 text-on-dark">
      <div className="max-w-lg text-center">
        <h1 className="text-4xl font-bold md:text-5xl">
          صار خلل مؤقت<span className="text-gold">.</span>
        </h1>
        <p className="mt-4 text-lg text-muted">ما قدرنا نعرض الصفحة هلّق. جرّب مرة ثانية بعد لحظات.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-8">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-12 items-center rounded-sm bg-gold px-8 font-medium text-ink"
          >
            حاول مرة ثانية
          </button>
          <Link href="/" className="underline decoration-1 underline-offset-8">
            الرئيسية
          </Link>
        </div>
      </div>
    </main>
  );
}
