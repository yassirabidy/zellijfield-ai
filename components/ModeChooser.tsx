import Link from 'next/link';
import BrandMark from './BrandMark';

// First screen on every visit: pick the Local dashboard (this PC's GPU, no keys) or the API-key
// dashboard (cloud studios with your own Muapi key). The two dashboards are separate pages.

function Card({ href, testId, title, subtitle, points, cta, icon }: {
  href: string; testId: string; title: string; subtitle: string; points: string[]; cta: string; icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group flex flex-col rounded-2xl border border-white/10 bg-[#0a0a0b] p-7 transition-all hover:-translate-y-0.5 hover:border-[#d1fe17]/50 hover:shadow-[0_0_40px_rgba(209,254,23,0.08)]"
    >
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-[#d1fe17]/20 bg-[#d1fe17]/10 text-[#d1fe17]">
        {icon}
      </div>
      <h2 className="text-xl font-bold text-white">{title}</h2>
      <p className="mt-1 text-[13px] text-white/50">{subtitle}</p>
      <ul className="mt-5 flex-1 space-y-2 text-[13px] text-white/70">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#d1fe17]" />
            {p}
          </li>
        ))}
      </ul>
      <span className="mt-7 flex h-11 items-center justify-center rounded-lg bg-[#d1fe17] text-[13px] font-bold text-black transition-colors group-hover:bg-[#b2d814]">
        {cta}
      </span>
    </Link>
  );
}

export default function ModeChooser() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#030303] px-4 py-12 text-white">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#d1fe17] shadow-lg shadow-[#d1fe17]/20">
          <BrandMark size={36} />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Zellijfield AI</h1>
        <p className="mt-2 text-[14px] text-white/50">How do you want to create today?</p>
      </div>

      <div className="grid w-full max-w-3xl gap-5 md:grid-cols-2">
        <Card
          href="/local/video"
          testId="choose-local"
          title="Local"
          subtitle="Runs on this PC's GPU. No API key, nothing leaves the machine."
          points={['Video models via Wan2GP and ComfyUI', 'Job queue with live progress', 'Gallery of everything you generated']}
          cta="Open local studio"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
          }
        />
        <Card
          href="/studio"
          testId="choose-api"
          title="API key"
          subtitle="Cloud studios powered by your own Muapi key."
          points={['Image, video, lip sync, cinema and more', 'Hundreds of cloud models', 'Your key is stored on this PC, never in the browser']}
          cta="Open cloud studio"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L12 17.25l-4.5-4.5L15.5 7.5z" />
            </svg>
          }
        />
      </div>
    </main>
  );
}
