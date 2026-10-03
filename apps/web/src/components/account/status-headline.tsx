import type { PositionHeadline } from "@/lib/position-headline";

const TONE: Record<PositionHeadline["tone"], string> = {
  stop: "border-signal-stop text-signal-stop",
  warn: "border-signal-warn text-signal-warn",
  verified: "border-signal-verified text-signal-verified",
  neutral: "border-ink text-ink",
};

export function StatusHeadline({ headline }: { headline: PositionHeadline }) {
  return <div className={`border-t-2 pt-5 ${TONE[headline.tone]}`} role="status">
    <h1 className="type-display max-w-5xl text-poster-lg leading-[.95] sm:text-poster-xl lg:text-poster-2xl">{headline.title}</h1>
    <p className="mt-4 max-w-[65ch] text-sm leading-relaxed text-ink sm:text-base">{headline.detail}</p>
  </div>;
}
