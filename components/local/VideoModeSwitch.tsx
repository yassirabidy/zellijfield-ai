'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import LocalVideoStudio from './LocalVideoStudio';
import MuapiRequired from './MuapiRequired';

type Mode = 'local' | 'cloud';
const STORAGE_KEY = 'zf_video_mode';

interface Props {
  hasMuapiKey: boolean;
  onAddKey: () => void;
  // The upstream Muapi Video Studio, rendered only in Cloud mode.
  cloud: ReactNode;
  onGenerationStart?: () => void;
  onGenerationEnd?: () => void;
  onGenerationComplete?: (data: { url: string }) => void;
  onGenerationError?: (message: string) => void;
}

// Video Studio with Local (default: Wan2GP / ComfyUI / mock on this machine) and Cloud (Muapi) modes.
export default function VideoModeSwitch({ hasMuapiKey, onAddKey, cloud, ...callbacks }: Props) {
  const [mode, setMode] = useState<Mode>('local');

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'cloud') setMode('cloud');
    } catch { /* storage unavailable: keep the default */ }
  }, []);

  const choose = (next: Mode) => {
    setMode(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* optional */ }
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-white/[0.06] bg-[#0a0a0b] px-4 py-2" role="tablist" aria-label="Video mode">
        {(['local', 'cloud'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            data-testid={`video-mode-${m}`}
            onClick={() => choose(m)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${mode === m ? 'bg-[#22d3ee]/15 text-[#22d3ee]' : 'text-white/50 hover:text-white'}`}
          >
            {m === 'local' ? 'Local (this PC)' : 'Cloud (Muapi)'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'local' && <LocalVideoStudio {...callbacks} />}
        {mode === 'cloud' && (hasMuapiKey ? cloud : <MuapiRequired onAddKey={onAddKey} feature="Cloud video" />)}
      </div>
    </div>
  );
}
