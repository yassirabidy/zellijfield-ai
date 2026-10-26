'use client';

import { useState } from 'react';
import type { EngineAction, EngineId, EnginesSnapshot, EngineState } from '@/lib/client/api';
import { api } from '@/lib/client/api';

// Engines section of the Models page: the Wan2GP and ComfyUI engines with their disk usage and
// install / start / stop / delete buttons. The work is done by the Windows-side engine manager
// (scripts/engine-manager.ps1); this only sends requests and shows its status.

const OP_LABEL: Record<EngineAction, string> = { install: 'Installing', start: 'Starting', stop: 'Stopping', delete: 'Deleting' };

export function engineLabel(e: EngineState): { text: string; className: string } {
  if (e.op?.status === 'running') return { text: `${OP_LABEL[e.op.action]}…`, className: 'border-[#d1fe17]/30 bg-[#d1fe17]/10 text-[#d1fe17]' };
  if (!e.installed) return { text: 'Not installed', className: 'border-white/15 bg-white/5 text-white/60' };
  if (e.container === 'running') {
    return e.ready
      ? { text: 'Running', className: 'border-lime-500/30 bg-lime-500/10 text-lime-300' }
      : { text: 'Starting…', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' };
  }
  return { text: 'Stopped', className: 'border-white/15 bg-white/5 text-white/60' };
}

export default function EnginesPanel({ snapshot, usage, onChanged }: {
  snapshot: EnginesSnapshot | null;
  // Names of downloaded models per engine.
  usage: Record<EngineId, string[]>;
  onChanged: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<EngineId | null>(null);
  const [error, setError] = useState<{ id: EngineId; text: string } | null>(null);
  const [sending, setSending] = useState<EngineId | null>(null);

  async function send(id: EngineId, action: EngineAction) {
    setSending(id);
    setError(null);
    try {
      await api.engineAction(id, action);
    } catch (err) {
      setError({ id, text: (err as Error).message });
    } finally {
      setSending(null);
      setConfirmDelete(null);
      onChanged();
    }
  }

  const online = snapshot?.managerOnline ?? false;
  const btn = 'h-8 rounded-md px-3 text-[12px] font-bold disabled:opacity-40';

  return (
    <section className="rounded-xl border border-white/[0.07] bg-[#0a0a0b] p-5" data-testid="engines-panel">
      <h2 className="text-[15px] font-bold text-white">Engines</h2>
      <p className="mt-1 text-[12px] leading-5 text-white/45">
        Local models run inside an engine. Each engine is installed once (a large download the first time) and can be stopped when not in use or deleted to free disk space. Downloading a model installs its engine automatically.
      </p>
      {snapshot && !online && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200" data-testid="engine-manager-offline">
          The engine manager is not running, so engines can&apos;t be controlled from here. Start Zellijfield AI with <span className="font-mono">start.bat</span>.
        </p>
      )}
      {snapshot && online && !snapshot.dockerOk && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">Docker Desktop is not running. Start it to use the engines.</p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(snapshot?.engines ?? []).map((e) => {
          const label = engineLabel(e);
          const running = e.op?.status === 'running';
          const disabled = !online || !snapshot?.dockerOk || running || e.busy || sending === e.id;
          const usedBy = usage[e.id] ?? [];
          return (
            <div key={e.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4" data-testid={`engine-${e.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[14px] font-semibold text-white">{e.name}</div>
                  <div className="mt-0.5 text-[11px] text-white/45" data-testid="engine-size">
                    {e.installed ? `Uses ${e.sizeLabel ?? '?'} of disk space` : `Needs ${e.sizeEstimate} of disk space`}
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${label.className}`} data-testid="engine-status">{label.text}</span>
              </div>

              <div className="mt-2 text-[11px] text-white/40">
                {usedBy.length ? `Downloaded models: ${usedBy.join(', ')}` : 'No downloaded models use it.'}
              </div>

              {running && e.op && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(e.op.progress * 100)}>
                    <div className="h-full rounded-full bg-[#d1fe17] transition-[width]" style={{ width: `${Math.max(3, e.op.progress * 100)}%` }} />
                  </div>
                  <div className="mt-1 truncate text-[10px] text-white/40" title={e.op.message ?? ''}>
                    {e.op.action === 'install' ? 'The first install downloads and builds the engine; this can take 30–60 minutes. ' : ''}{e.op.message}
                  </div>
                </div>
              )}
              {e.op?.status === 'failed' && <p className="mt-2 whitespace-pre-wrap text-[11px] text-red-300" role="alert">{OP_LABEL[e.op.action]} failed: {e.op.error}</p>}
              {error?.id === e.id && <p className="mt-2 text-[11px] text-red-300" role="alert" data-testid="engine-error">{error.text}</p>}

              <div className="mt-3 flex flex-wrap gap-2">
                {!e.installed && (
                  <button type="button" disabled={disabled} onClick={() => void send(e.id, 'install')} data-testid="engine-install" className={`${btn} bg-[#d1fe17] text-black hover:bg-[#b2d814]`}>Install</button>
                )}
                {e.installed && e.container !== 'running' && (
                  <button type="button" disabled={disabled} onClick={() => void send(e.id, 'start')} data-testid="engine-start" className={`${btn} bg-[#d1fe17] text-black hover:bg-[#b2d814]`}>Start</button>
                )}
                {e.installed && e.container === 'running' && (
                  <button type="button" disabled={disabled} onClick={() => void send(e.id, 'stop')} data-testid="engine-stop" className={`${btn} border border-white/15 bg-white/5 text-white/80 hover:bg-white/10`}>Stop</button>
                )}
                {e.installed && confirmDelete !== e.id && (
                  <button type="button" disabled={disabled} onClick={() => setConfirmDelete(e.id)} data-testid="engine-delete" className={`${btn} border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20`}>Delete</button>
                )}
                {confirmDelete === e.id && (
                  <>
                    <button type="button" disabled={disabled} onClick={() => void send(e.id, 'delete')} data-testid="engine-confirm-delete" className={`${btn} bg-red-500 text-white hover:bg-red-600`}>
                      Delete the engine{e.sizeLabel ? ` (frees ${e.sizeLabel})` : ''}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(null)} className={`${btn} border border-white/15 bg-white/5 text-white/70`}>Keep</button>
                  </>
                )}
              </div>
              {confirmDelete === e.id && usedBy.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-200/80">Downloaded models stay on disk, but they can&apos;t run until the engine is installed again.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
