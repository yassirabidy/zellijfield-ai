'use client';

import Link from 'next/link';

// Shown in place of the Muapi-powered studios when no Muapi key is configured. Local generation
// works without it.
export default function MuapiRequired({ onAddKey, feature }: { onAddKey: () => void; feature?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6" data-testid="muapi-required">
      <div className="max-w-md rounded-xl border border-white/10 bg-[#0a0a0a] p-8 text-center">
        <h2 className="mb-2 text-lg font-bold text-white">{feature ? `${feature} uses Muapi` : 'This studio uses Muapi'}</h2>
        <p className="mb-6 text-[13px] leading-5 text-white/50">
          Cloud studios run on Muapi and need your own Muapi API key. The key is stored on this
          machine&apos;s server and never sent to the browser. Local video generation works without it.
        </p>
        <div className="flex justify-center gap-3">
          <button type="button" onClick={onAddKey} className="h-10 rounded-md bg-[#22d3ee] px-4 text-[13px] font-bold text-black hover:bg-[#06b6d4]">
            Add Muapi key
          </button>
          <Link href="/studio/video" className="flex h-10 items-center rounded-md border border-white/10 px-4 text-[13px] font-semibold text-white/80 hover:text-white">
            Local video
          </Link>
        </div>
      </div>
    </div>
  );
}
