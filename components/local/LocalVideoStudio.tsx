'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GalleryItem, Job, ModelInfo } from '@/lib/client/api';
import { api, LOCAL_BACKENDS, mediaUrl, TERMINAL, watchJob } from '@/lib/client/api';
import StatusBadge from './StatusBadge';

const BACKEND_LABEL: Record<ModelInfo['backend'], string> = {
  mock: 'Mock',
  wan2gp: 'Wan2GP',
  comfyui: 'ComfyUI',
  fal: 'fal',
  replicate: 'Replicate',
};

interface Props {
  // Which local models to offer.
  mediaType?: ModelInfo['type'];
  onGenerationStart?: () => void;
  onGenerationEnd?: () => void;
  onGenerationComplete?: (data: { url: string }) => void;
  onGenerationError?: (message: string) => void;
}

function toInt(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

function FilePicker({ label, accept, required, uploading, fileName, onPick, onClear, testId }: {
  label: string; accept: string; required: boolean; uploading: boolean; fileName: string | null;
  onPick: (f: File) => void; onClear: () => void; testId: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-white/40">
        <span>{label}{required ? ' *' : ' (optional)'}</span>
        {fileName && <button type="button" onClick={onClear} className="normal-case text-white/50 hover:text-white">Remove</button>}
      </div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex h-11 w-full items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.02] text-[12px] text-white/60 transition-colors hover:border-[#d1fe17]/40 hover:text-white"
      >
        {uploading ? 'Uploading…' : fileName ?? `Choose ${label.toLowerCase()}`}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export default function LocalVideoStudio({ mediaType = 'video', onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError }: Props) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelId, setModelId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('');
  const [seed, setSeed] = useState('');
  const [steps, setSteps] = useState('');
  const [frames, setFrames] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [image, setImage] = useState<{ id: string; name: string } | null>(null);
  const [audio, setAudio] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState<'image' | 'audio' | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const stopWatching = useRef<(() => void) | null>(null);

  const model = useMemo(() => models?.find((m) => m.id === modelId) ?? null, [models, modelId]);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const [all, settings] = await Promise.all([api.models(), api.settings().catch(() => null)]);
      const list = all.filter((m) => m.type === mediaType && LOCAL_BACKENDS.includes(m.backend));
      setModels(list);
      // First choice: keep the current selection, else the first model of the default backend.
      const preferred = list.find((m) => m.backend === settings?.defaultBackend) ?? list[0];
      setModelId((current) => (current && list.some((m) => m.id === current) ? current : preferred?.id ?? ''));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingModels(false);
    }
  }, [mediaType]);

  const loadGallery = useCallback(() => {
    api.gallery().then((items) => setGallery(items.slice(0, 12))).catch(() => {});
  }, []);

  useEffect(() => {
    void loadModels();
    loadGallery();
    return () => stopWatching.current?.();
  }, [loadModels, loadGallery]);

  // Keep options valid for the selected model.
  useEffect(() => {
    if (!model) return;
    setAspectRatio((r) => (model.aspectRatios.includes(r) ? r : model.aspectRatios[0] ?? ''));
    if (model.inputs.image === 'none') setImage(null);
    if (model.inputs.audio === 'none') setAudio(null);
  }, [model]);

  const busy = job !== null && !TERMINAL.includes(job.status);
  const missingInput = model && ((model.inputs.image === 'required' && !image) || (model.inputs.audio === 'required' && !audio));
  const canGenerate = Boolean(model && prompt.trim() && !missingInput && !busy && !uploading);

  const upload = async (kind: 'image' | 'audio', file: File) => {
    setUploading(kind);
    setError(null);
    try {
      const saved = await api.upload(file);
      if (saved.kind !== kind) throw new Error(`That file is ${saved.kind === 'image' ? 'an image' : 'audio'}, not ${kind === 'image' ? 'an image' : 'audio'}.`);
      (kind === 'image' ? setImage : setAudio)({ id: saved.id, name: file.name });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  };

  const generate = async () => {
    if (!model) return;
    setError(null);
    try {
      const submitted = await api.submitJob({
        modelId: model.id,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        aspectRatio: aspectRatio || undefined,
        seed: toInt(seed),
        steps: toInt(steps),
        frames: toInt(frames),
        imageUploadId: image?.id,
        audioUploadId: audio?.id,
      });
      setJob(submitted);
      onGenerationStart?.();
      stopWatching.current?.();
      stopWatching.current = watchJob(submitted.id, (update) => {
        setJob(update);
        if (!TERMINAL.includes(update.status)) return;
        onGenerationEnd?.();
        if (update.status === 'succeeded' && update.outputPath) {
          onGenerationComplete?.({ url: mediaUrl(update.outputPath) });
          loadGallery();
        } else if (update.status === 'failed') {
          onGenerationError?.(update.error ?? 'Generation failed');
        }
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const cancel = async () => {
    if (job) await api.cancelJob(job.id).catch((err) => setError((err as Error).message));
  };

  const resultUrl = job?.status === 'succeeded' && job.outputPath ? mediaUrl(job.outputPath) : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden md:flex-row" data-testid="local-video-studio" data-media-type={mediaType}>
      {/* Controls */}
      <aside className="flex w-full flex-shrink-0 flex-col gap-5 overflow-y-auto border-b border-white/[0.06] bg-[#0a0a0b] p-5 md:w-[380px] md:border-b-0 md:border-r">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Model</span>
            <button type="button" onClick={() => void loadModels()} className="text-[11px] text-white/50 hover:text-white" data-testid="refresh-status">
              {loadingModels ? 'Checking…' : 'Refresh status'}
            </button>
          </div>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Model">
            {models === null && <div className="text-[12px] text-white/40">Loading models…</div>}
            {models?.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === modelId}
                data-testid={`model-${m.id}`}
                onClick={() => setModelId(m.id)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${m.id === modelId ? 'border-[#d1fe17]/40 bg-[#d1fe17]/10' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-white">{m.name}</span>
                  <StatusBadge status={m.availability.status} detail={m.availability.detail} />
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/40">
                  <span>{BACKEND_LABEL[m.backend]}</span>
                  {m.experimental && <span className="rounded bg-purple-500/15 px-1.5 text-purple-300">experimental</span>}
                </div>
              </button>
            ))}
          </div>
          {model && model.availability.status !== 'installed' && model.availability.detail && (
            <p className="mt-2 text-[11px] leading-4 text-amber-200/70" data-testid="status-detail">{model.availability.detail}</p>
          )}
          {model?.todo.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-4 text-white/35">
              {model.todo.map((t) => <li key={t}>{t}</li>)}
            </ul>
          ) : null}
        </div>

        <div>
          <label htmlFor="local-prompt" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-white/40">Prompt *</label>
          <textarea
            id="local-prompt"
            data-testid="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder={mediaType === 'video' ? 'Describe the shot: subject, action, camera, light…' : 'Describe the image: subject, style, composition, light…'}
            className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[13px] text-white placeholder:text-white/25 focus:border-[#d1fe17]/50 focus:outline-none"
          />
        </div>

        {model && model.inputs.image !== 'none' && (
          <FilePicker label="Start image" accept="image/png,image/jpeg,image/webp" required={model.inputs.image === 'required'}
            uploading={uploading === 'image'} fileName={image?.name ?? null} onPick={(f) => void upload('image', f)} onClear={() => setImage(null)} testId="image-input" />
        )}
        {model && model.inputs.audio !== 'none' && (
          <FilePicker label="Voice clip" accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" required={model.inputs.audio === 'required'}
            uploading={uploading === 'audio'} fileName={audio?.name ?? null} onPick={(f) => void upload('audio', f)} onClear={() => setAudio(null)} testId="audio-input" />
        )}

        {model && model.aspectRatios.length > 1 && (
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-white/40">Aspect ratio</span>
            <div className="flex gap-1.5">
              {model.aspectRatios.map((r) => (
                <button key={r} type="button" onClick={() => setAspectRatio(r)}
                  className={`flex-1 rounded-md border py-1.5 text-[12px] font-semibold ${r === aspectRatio ? 'border-[#d1fe17]/50 bg-[#d1fe17]/10 text-[#d1fe17]' : 'border-white/10 text-white/60 hover:text-white'}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-[12px] font-semibold text-white/50 hover:text-white">
            {showAdvanced ? '− Advanced' : '+ Advanced'}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} rows={2} maxLength={2000} placeholder="Negative prompt"
                className="col-span-3 resize-none rounded-lg border border-white/10 bg-white/[0.03] p-2 text-[12px] text-white placeholder:text-white/25 focus:outline-none" />
              {[
                ['Seed', seed, setSeed, 'random'],
                ['Steps', steps, setSteps, model?.defaults.steps ? String(model.defaults.steps) : 'default'],
                ['Frames', frames, setFrames, model?.defaults.frames ? String(model.defaults.frames) : 'default'],
              ].map(([label, value, setter, placeholder]) => (
                <label key={label as string} className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                  {label as string}
                  <input inputMode="numeric" value={value as string} placeholder={placeholder as string}
                    onChange={(e) => (setter as (v: string) => void)(e.target.value.replace(/[^\d]/g, ''))}
                    className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[12px] normal-case text-white placeholder:text-white/25 focus:outline-none" />
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300" data-testid="error">{error}</div>}

        <button
          type="button"
          data-testid="generate"
          disabled={!canGenerate}
          onClick={() => void generate()}
          className="h-11 flex-shrink-0 rounded-lg bg-[#d1fe17] text-[13px] font-bold text-black transition-colors hover:bg-[#b2d814] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </aside>

      {/* Output */}
      <section className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5 md:p-8">
        {job ? (
          <div className="rounded-xl border border-white/[0.06] bg-[#0a0a0b] p-5" data-testid="job-card" data-status={job.status}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-white">{job.params.prompt}</div>
                <div className="text-[11px] text-white/40">{models?.find((m) => m.id === job.modelId)?.name ?? job.modelId}</div>
              </div>
              {busy ? (
                <button type="button" onClick={() => void cancel()} data-testid="cancel" className="rounded-md border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/70 hover:text-white">Cancel</button>
              ) : (
                <span className={`text-[12px] font-semibold ${job.status === 'succeeded' ? 'text-lime-300' : job.status === 'failed' ? 'text-red-300' : 'text-white/50'}`} data-testid="job-status">{job.status}</span>
              )}
            </div>
            {busy && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
                  <div className="h-full rounded-full bg-gradient-to-r from-[#d1fe17] to-[#a855f7] transition-all duration-300" style={{ width: `${Math.max(2, job.progress * 100)}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-white/50" data-testid="job-message">
                  <span>{job.status === 'queued' ? 'Waiting for the GPU…' : job.message}</span>
                  <span>{Math.round(job.progress * 100)}%</span>
                </div>
              </>
            )}
            {job.status === 'failed' && <p className="mt-2 whitespace-pre-wrap text-[12px] text-red-300" data-testid="job-error">{job.error}</p>}
            {resultUrl && (
              job.mediaType === 'image'
                ? <img src={resultUrl} alt={job.params.prompt} className="mt-3 max-h-[60vh] w-full rounded-lg object-contain" />
                : <video src={resultUrl} controls autoPlay loop muted playsInline className="mt-3 max-h-[60vh] w-full rounded-lg bg-black" data-testid="result-video" />
            )}
          </div>
        ) : (
          <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-white/10 text-center text-[13px] text-white/35">
            Pick a model, write a prompt and press Generate.<br />Jobs run one at a time on the GPU; progress appears here.
          </div>
        )}

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-white/80">Recent outputs</h2>
            <Link href="/gallery" className="text-[12px] text-[#d1fe17] hover:underline">Open gallery</Link>
          </div>
          {gallery.length === 0 ? (
            <p className="text-[12px] text-white/35">Nothing yet. Results are saved to data/outputs/studio.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" data-testid="recent-outputs">
              {gallery.map((item) => (
                <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border border-white/[0.06] bg-black">
                  {item.mediaType === 'video'
                    ? <video src={item.url} muted playsInline preload="metadata" className="aspect-video w-full object-cover" />
                    : <img src={item.url} alt={item.prompt ?? ''} className="aspect-video w-full object-cover" />}
                  <div className="truncate px-2 py-1.5 text-[11px] text-white/50 group-hover:text-white/80">{item.prompt ?? item.id}</div>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
