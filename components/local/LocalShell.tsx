'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ModelInfo } from '@/lib/client/api';
import { api, LOCAL_BACKENDS } from '@/lib/client/api';
import GalleryGrid from './GalleryGrid';
import LocalVideoStudio from './LocalVideoStudio';
import SettingsPanel from './SettingsPanel';

// Local dashboard: same look as the cloud dashboard, but only features that run on this PC.
// A media section (Video, Images) appears only when models.json has local models of that type.

export type LocalTab = 'video' | 'image' | 'gallery' | 'settings';

const ICONS: Record<LocalTab, React.ReactNode> = {
  video: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></svg>,
  image: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>,
  gallery: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  settings: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>,
};

const LABELS: Record<LocalTab, string> = { video: 'Video Studio', image: 'Image Studio', gallery: 'Gallery', settings: 'Settings' };

export default function LocalShell({ tab }: { tab: LocalTab }) {
  const [models, setModels] = useState<Omit<ModelInfo, 'availability'>[] | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    api.registry().then((list) => setModels(list.filter((m) => LOCAL_BACKENDS.includes(m.backend)))).catch(() => setModels([]));
  }, []);

  const tabs = useMemo<LocalTab[]>(() => {
    const has = (type: ModelInfo['type']) => models?.some((m) => m.type === type) ?? false;
    return [...(has('video') ? ['video' as const] : []), ...(has('image') ? ['image' as const] : []), 'gallery', 'settings'];
  }, [models]);

  // A media tab without local models (e.g. /local/image) falls back to the first available one.
  const active: LocalTab = models === null || tabs.includes(tab) ? tab : tabs[0];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#030303] text-white" data-testid="local-shell">
      <header className="z-20 flex h-14 flex-shrink-0 items-center justify-between gap-4 border-b border-white/[0.05] bg-[#0a0a0b]/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setMobileOpen((v) => !v)} className="rounded-lg bg-white/5 p-2 text-white/70 md:hidden" aria-label="Toggle navigation">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <Link href="/" className="flex items-center gap-2.5" title="Choose Local or API key">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d1fe17] shadow-lg shadow-[#d1fe17]/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
            </div>
            <span className="hidden text-sm font-bold tracking-tight sm:block">Zellijfield AI</span>
          </Link>
          <span className="rounded-full border border-[#d1fe17]/30 bg-[#d1fe17]/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#d1fe17]" data-testid="mode-badge">Local</span>
        </div>
        <Link href="/" data-testid="switch-mode" className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] font-bold text-white/80 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white">
          Switch mode
        </Link>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {mobileOpen && <div className="fixed inset-0 z-30 bg-black/70 md:hidden" onClick={() => setMobileOpen(false)} />}
        <aside className={`fixed bottom-0 left-0 top-14 z-40 w-56 flex-shrink-0 border-r border-white/[0.06] bg-[#0a0a0b]/95 p-2 transition-transform md:static md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <nav aria-label="Local studio" className="space-y-1">
            {tabs.map((t) => {
              const isActive = t === active;
              return (
                <Link
                  key={t}
                  href={`/local/${t}`}
                  data-testid={`local-nav-${t}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={`relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[13px] font-semibold transition-colors ${isActive ? 'border-[#d1fe17]/20 bg-gradient-to-r from-[#d1fe17]/15 to-purple-500/10 text-[#d1fe17]' : 'border-transparent text-white/60 hover:bg-white/[0.04] hover:text-white'}`}
                >
                  {isActive && <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-gradient-to-b from-[#d1fe17] to-[#a855f7]" />}
                  {ICONS[t]}
                  {LABELS[t]}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {models === null ? (
            <div className="flex h-full items-center justify-center text-white/30">Loading…</div>
          ) : active === 'video' || active === 'image' ? (
            <LocalVideoStudio key={active} mediaType={active} />
          ) : active === 'gallery' ? (
            <GalleryGrid embedded />
          ) : (
            <SettingsPanel embedded sections={['backends', 'models']} />
          )}
        </main>
      </div>
    </div>
  );
}
