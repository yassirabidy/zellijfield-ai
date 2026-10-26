'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DownloadState, EngineId, EnginesSnapshot, ModelDownloadInfo, ModelInfo } from '@/lib/client/api';
import { api } from '@/lib/client/api';
import EnginesPanel from './EnginesPanel';
import StatusBadge from './StatusBadge';

// Models page of the Local dashboard: download a model's weights when it is needed and remove
// them again to free disk space. Wan2GP models are fetched by WanGP itself (inside its
// container); ComfyUI models are fetched by the studio from the sources in models.json.

const POLL_MS = 1500;
const ENGINE_POLL_MS = 3000;
const ACTIVE: DownloadState['status'][] = ['waiting-engine', 'running', 'cancelling'];

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function Progress({ d, starting }: { d: DownloadState; starting: string }) {
  const fraction = d.total && d.completed ? Math.min(1, d.completed / d.total) : null;
  const parts: string[] = [];
  if (d.fileCount && d.fileCount > 1) parts.push(`File ${d.fileIndex ?? 1} of ${d.fileCount}`);
  if (d.file) parts.push(d.file);
  if (fraction !== null && d.total) parts.push(`${formatBytes(d.completed!)} of ${formatBytes(d.total)}`);
  else if (d.file && d.received) parts.push(`${formatBytes(d.received)} received`);
  else if (d.status !== 'cancelling') parts.push(starting);
  if (d.status === 'cancelling') parts.push('Cancelling…');
  return (
    <div className="mt-3" data-testid="download-progress">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
        className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
      >
        <div
          className={`h-full rounded-full bg-[#d1fe17] transition-[width] ${fraction === null ? 'w-1/3 animate-pulse' : ''}`}
          style={fraction === null ? undefined : { width: `${Math.max(2, fraction * 100)}%` }}
        />
      </div>
      <div className="mt-1.5 truncate text-[11px] text-white/45">{parts.join(' · ')}</div>
    </div>
  );
}

export default function ModelManager() {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [downloads, setDownloads] = useState<Record<string, ModelDownloadInfo>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ modelId: string; kind: 'ok' | 'error'; text: string } | null>(null);
  const [engines, setEngines] = useState<EnginesSnapshot | null>(null);
  const [confirmInstall, setConfirmInstall] = useState<string | null>(null);
  const wasActive = useRef(new Set<string>());

  const loadStatus = useCallback(async () => {
    const list = await api.models().catch(() => []);
    setModels(list.filter((m) => m.backend === 'wan2gp' || m.backend === 'comfyui'));
  }, []);

  const loadDownloads = useCallback(async () => {
    const list = await api.downloads().catch(() => null);
    if (!list) return;
    setDownloads(Object.fromEntries(list.map((d) => [d.modelId, d])));
    // Refresh install status when a download ends.
    const active = new Set(list.filter((d) => d.download && ACTIVE.includes(d.download.status)).map((d) => d.modelId));
    const finished = [...wasActive.current].filter((id) => !active.has(id));
    wasActive.current = active;
    if (finished.length) void loadStatus();
  }, [loadStatus]);

  const engineWasBusy = useRef(false);
  const loadEngines = useCallback(async () => {
    const snap = await api.engines().catch(() => null);
    setEngines(snap);
    // Refresh model status when an engine operation ends (e.g. Wan2GP became reachable).
    const busyNow = !!snap?.engines.some((e) => e.busy || e.op?.status === 'running' || (e.container === 'running' && !e.ready));
    if (engineWasBusy.current && !busyNow) void loadStatus();
    engineWasBusy.current = busyNow;
  }, [loadStatus]);

  useEffect(() => {
    void loadStatus();
    void loadDownloads();
    void loadEngines();
  }, [loadStatus, loadDownloads, loadEngines]);

  const anyActive = Object.values(downloads).some((d) => d.download && ACTIVE.includes(d.download.status));
  const enginesBusy = !!engines?.engines.some((e) => e.busy || e.op?.status === 'running' || (e.container === 'running' && !e.ready));
  useEffect(() => {
    if (!anyActive && !enginesBusy) return;
    const timer = setInterval(() => {
      void loadDownloads();
      void loadEngines();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [anyActive, enginesBusy, loadDownloads, loadEngines]);

  // Engine state also changes outside this page (start.bat, Docker Desktop); reading it is cheap.
  useEffect(() => {
    const timer = setInterval(() => void loadEngines(), ENGINE_POLL_MS);
    return () => clearInterval(timer);
  }, [loadEngines]);

  const engineOf = (m: ModelInfo) => engines?.engines.find((e) => e.id === m.backend) ?? null;
  const isDownloaded = (m: ModelInfo) => {
    const files = downloads[m.id]?.files;
    return m.availability.status === 'installed' || (!!files && files.present > 0);
  };
  // Downloaded models per engine (for the Engines section and the "delete the engine?" hint).
  const usage: Record<EngineId, string[]> = { wan2gp: [], comfyui: [] };
  for (const m of models ?? []) if (isDownloaded(m) && (m.backend === 'wan2gp' || m.backend === 'comfyui')) usage[m.backend].push(m.name);

  async function act(modelId: string, action: () => Promise<string | void>) {
    setBusy(modelId);
    setNotice(null);
    try {
      const text = await action();
      if (text) setNotice({ modelId, kind: 'ok', text });
    } catch (err) {
      setNotice({ modelId, kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
      setConfirming(null);
      setConfirmInstall(null);
      await Promise.all([loadDownloads(), loadEngines()]);
    }
  }

  const download = (id: string) => act(id, async () => {
    await api.startDownload(id);
  });
  const cancel = (id: string) => act(id, async () => {
    await api.cancelDownload(id);
  });
  const remove = (id: string) =>
    act(id, async () => {
      const r = await api.removeModel(id);
      void loadStatus();
      const model = models?.find((m) => m.id === id);
      const engine = model ? engineOf(model) : null;
      const othersUseEngine = (models ?? []).some((m) => m.id !== id && m.backend === model?.backend && isDownloaded(m));
      const hint = engine?.installed && !othersUseEngine ? ` No other downloaded model uses ${engine.name}: you can delete the engine under Engines to free ${engine.sizeLabel ?? 'its space'}.` : '';
      const kept = (r.keptShared.length ? ` Kept ${r.keptShared.length} file(s) another model still uses.` : '') + hint;
      if (r.removed.length) return `Removed ${r.removed.length} file(s), freed ${formatBytes(r.bytesFreed)}.${kept}`;
      if (r.bytesFreed) return `Deleted the unfinished download, freed ${formatBytes(r.bytesFreed)}.${kept}`;
      return `Nothing to remove.${kept}`;
    });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">Models</h1>
            <p className="mt-1 text-[13px] leading-5 text-white/45">
              Download a model when you need it and remove it when you don&apos;t, to free disk space. Large models are tens of GB, so the first download takes a while.
            </p>
          </div>
          <button type="button" onClick={() => void Promise.all([loadStatus(), loadDownloads()])} data-testid="refresh-models"
            className="h-9 flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-3 text-[13px] font-bold text-white/80 hover:bg-white/10">
            Refresh
          </button>
        </div>

        <EnginesPanel snapshot={engines} usage={usage} onChanged={() => void loadEngines()} />

        {models === null ? (
          <p className="text-[13px] text-white/40">Checking models…</p>
        ) : models.length === 0 ? (
          <p className="text-[13px] text-white/40">No local models in models.json.</p>
        ) : (
          <ul className="space-y-3" data-testid="model-manager-list">
            {models.map((m) => {
              const info = downloads[m.id];
              const d = info?.download ?? null;
              const running = !!d && ACTIVE.includes(d.status);
              const files = info?.files;
              const installed = m.availability.status === 'installed' || (!!files && files.total > 0 && files.present === files.total);
              const hasFiles = installed || (!!files && (files.present > 0 || files.partialBytes > 0)) || (m.backend === 'wan2gp' && m.availability.status !== 'unreachable');
              const canDownload = !!info?.downloadable && !installed && !running;
              const engine = engineOf(m);
              // With the engine manager, a missing engine is installed before the model.
              const needsEngine = !!engines?.managerOnline && !!engine && !engine.installed;
              const disabled = busy === m.id;
              return (
                <li key={m.id} className="rounded-xl border border-white/[0.07] bg-[#0a0a0b] p-5" data-testid={`manage-${m.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-white">
                        {m.name}
                        {m.experimental && <span className="ml-2 rounded bg-purple-500/15 px-1.5 text-[10px] text-purple-300">experimental</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-white/40">
                        {m.backend === 'wan2gp' ? 'Wan2GP' : 'ComfyUI'}
                        {files && ` · ${files.present} of ${files.total} file(s) on disk${files.bytes ? `, ${formatBytes(files.bytes)}` : ''}`}
                        {files && files.partialBytes > 0 && ` · ${formatBytes(files.partialBytes)} partly downloaded`}
                      </div>
                      {m.downloadSize && (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] font-semibold text-white/70" data-testid="download-size"
                          title="Total size of all the model's files. Files already downloaded for another model are not downloaded again.">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" /><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3" /></svg>
                          Needs {formatBytes(m.downloadSize)} of disk space
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {installed ? <StatusBadge status="installed" /> : <StatusBadge status={m.availability.status} detail={m.availability.detail} />}
                    </div>
                  </div>

                  {d?.status === 'waiting-engine' && engine && (
                    <div className="mt-3" data-testid="waiting-engine">
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((engine.op?.progress ?? 0) * 100)}>
                        <div className="h-full rounded-full bg-[#d1fe17]/60 transition-[width]" style={{ width: `${Math.max(3, (engine.op?.progress ?? 0) * 100)}%` }} />
                      </div>
                      <div className="mt-1.5 text-[11px] text-white/45">
                        {engine.op?.status === 'running'
                          ? `Step 1 of 2: ${engine.op.action === 'install' ? 'installing' : 'starting'} the ${engine.name} engine…`
                          : `Step 1 of 2: waiting for ${engine.name} to get ready…`}{' '}
                        The model download starts automatically after.
                      </div>
                    </div>
                  )}
                  {running && d && d.status !== 'waiting-engine' && <Progress d={d} starting={m.backend === 'wan2gp' ? 'Starting Wan2GP (takes a minute or two)…' : 'Preparing…'} />}
                  {d?.status === 'failed' && <p className="mt-3 text-[12px] text-red-300" role="alert">Download failed: {d.error}</p>}
                  {d?.status === 'cancelled' && <p className="mt-3 text-[12px] text-white/45">Download cancelled. Download again to continue.</p>}
                  {notice?.modelId === m.id && (
                    <p className={`mt-3 text-[12px] ${notice.kind === 'error' ? 'text-red-300' : 'text-lime-300'}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid="model-notice">
                      {notice.text}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {canDownload && confirmInstall !== m.id && (
                      <button type="button" disabled={disabled} onClick={() => (needsEngine ? setConfirmInstall(m.id) : void download(m.id))} data-testid="download-model"
                        className="h-9 rounded-md bg-[#d1fe17] px-4 text-[13px] font-bold text-black hover:bg-[#b2d814] disabled:opacity-50">
                        {needsEngine ? 'Install engine + download' : 'Download'}
                      </button>
                    )}
                    {canDownload && confirmInstall === m.id && engine && (
                      <div className="w-full rounded-lg border border-[#d1fe17]/25 bg-[#d1fe17]/5 p-3 text-[12px] text-white/75" data-testid="confirm-install">
                        This model runs in the <b>{engine.name}</b> engine, which is not installed yet. It is installed first ({engine.sizeEstimate}, 30–60 minutes the first time)
                        {m.downloadSize ? `, then the model is downloaded (${formatBytes(m.downloadSize)})` : ''}.
                        <div className="mt-2 flex gap-2">
                          <button type="button" disabled={disabled} onClick={() => void download(m.id)} data-testid="confirm-install-download"
                            className="h-8 rounded-md bg-[#d1fe17] px-3 text-[12px] font-bold text-black hover:bg-[#b2d814]">
                            Install engine + download
                          </button>
                          <button type="button" onClick={() => setConfirmInstall(null)} className="h-8 rounded-md border border-white/15 bg-white/5 px-3 text-[12px] font-bold text-white/70">Cancel</button>
                        </div>
                      </div>
                    )}
                    {running && (
                      <button type="button" disabled={disabled || d?.status === 'cancelling'} onClick={() => void cancel(m.id)} data-testid="cancel-download"
                        className="h-9 rounded-md border border-white/15 bg-white/5 px-4 text-[13px] font-bold text-white/80 hover:bg-white/10 disabled:opacity-50">
                        Cancel download
                      </button>
                    )}
                    {!running && hasFiles && confirming !== m.id && (
                      <button type="button" disabled={disabled} onClick={() => setConfirming(m.id)} data-testid="remove-model"
                        className="h-9 rounded-md border border-red-500/30 bg-red-500/10 px-4 text-[13px] font-bold text-red-300 hover:bg-red-500/20 disabled:opacity-50">
                        Remove
                      </button>
                    )}
                    {confirming === m.id && (
                      <>
                        <button type="button" disabled={disabled} onClick={() => void remove(m.id)} data-testid="confirm-remove"
                          className="h-9 rounded-md bg-red-500 px-4 text-[13px] font-bold text-white hover:bg-red-600 disabled:opacity-50">
                          {disabled ? 'Removing…' : 'Delete the model files'}
                        </button>
                        <button type="button" disabled={disabled} onClick={() => setConfirming(null)}
                          className="h-9 rounded-md border border-white/15 bg-white/5 px-4 text-[13px] font-bold text-white/70 hover:bg-white/10">
                          Keep
                        </button>
                      </>
                    )}
                  </div>
                  {m.backend === 'wan2gp' && !installed && !running && !engines?.managerOnline && (
                    <p className="mt-3 text-[11px] leading-4 text-white/35">Wan2GP must be running (the &quot;wan2gp&quot; or &quot;full&quot; start mode). Without a download here, it also fetches the files on the first generation.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
