'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { GalleryItem } from '@/lib/client/api';
import { api } from '@/lib/client/api';

export default function GalleryGrid() {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<GalleryItem | null>(null);

  useEffect(() => {
    api.gallery().then(setItems).catch((err) => setError((err as Error).message));
  }, []);

  return (
    <div className="min-h-screen bg-[#030303] text-white">
      <header className="flex h-14 items-center justify-between border-b border-white/[0.05] bg-[#0a0a0b]/80 px-5">
        <div className="flex items-center gap-3">
          <Link href="/studio/video" className="text-[13px] text-white/60 hover:text-white">← Studio</Link>
          <span className="text-sm font-bold">Gallery</span>
        </div>
        <Link href="/settings" className="text-[13px] text-white/60 hover:text-white">Settings</Link>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        {error && <p role="alert" className="text-[13px] text-red-300">{error}</p>}
        {items === null && !error && <p className="text-[13px] text-white/40">Loading…</p>}
        {items?.length === 0 && <p className="text-[13px] text-white/40">No outputs yet. Generated media is saved to data/outputs/studio.</p>}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4" data-testid="gallery-grid">
          {items?.map((item) => (
            <button key={item.id} type="button" onClick={() => setOpen(item)} className="group overflow-hidden rounded-xl border border-white/[0.06] bg-black text-left">
              {item.mediaType === 'video'
                ? <video src={item.url} muted playsInline preload="metadata" className="aspect-video w-full object-cover" />
                : <img src={item.url} alt={item.prompt ?? ''} className="aspect-video w-full object-cover" />}
              <div className="px-3 py-2">
                <div className="truncate text-[12px] text-white/70 group-hover:text-white">{item.prompt ?? item.id}</div>
                <div className="text-[11px] text-white/35">{item.modelId ?? 'file'} · {new Date(item.createdAt).toLocaleString()}</div>
              </div>
            </button>
          ))}
        </div>
      </main>
      {open && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            {open.mediaType === 'video'
              ? <video src={open.url} controls autoPlay className="max-h-[80vh] w-full rounded-lg bg-black" />
              : <img src={open.url} alt={open.prompt ?? ''} className="max-h-[80vh] w-full rounded-lg object-contain" />}
            <div className="mt-3 flex items-center justify-between gap-4 text-[13px] text-white/70">
              <span className="min-w-0 truncate">{open.prompt}</span>
              <div className="flex flex-shrink-0 gap-2">
                <a href={open.url} download className="rounded-md bg-[#d1fe17] px-3 py-1.5 text-[12px] font-bold text-black">Download</a>
                <button type="button" onClick={() => setOpen(null)} className="rounded-md border border-white/15 px-3 py-1.5 text-[12px]">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
