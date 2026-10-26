'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PROMPT_CONTROL_LABEL_CLASS,
  PROMPT_MEDIA_PREVIEW_CLASS,
  PromptAction,
  PromptAspectRatioIcon,
  PromptChevronIcon,
  PromptDurationIcon,
  PromptComposer,
  PromptControls,
  PromptFooter,
  PromptMenuItem,
  PromptMenuList,
  PromptPopover,
  PromptPopoverHeader,
  PromptTextarea,
  promptControlClassName,
  promptMediaButtonClassName,
} from 'studio/prompt';
import type { GalleryItem, Job, ModelInfo, Quality } from '@/lib/client/api';
import { api, LOCAL_BACKENDS, mediaUrl, TERMINAL, watchJob } from '@/lib/client/api';
import { durationOptions, formatSeconds, qualities, ratiosFor, sizeFor } from '@/lib/client/video';
import StatusBadge from './StatusBadge';

// Local Video Studio, laid out like the API dashboard's Video Studio: a hero for the selected
// model and a floating prompt bar at the bottom with the model picker and settings. It uses the
// same prompt-bar primitives (packages/studio/src/components/prompt) so both modes look alike.

const BACKEND_LABEL: Record<ModelInfo['backend'], string> = {
  mock: 'Mock',
  wan2gp: 'Wan2GP',
  comfyui: 'ComfyUI',
  fal: 'fal',
  replicate: 'Replicate',
};

type Menu = 'model' | 'quality' | 'ratio' | 'duration' | 'settings' | null;

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

type MediaKind = 'image' | 'endImage' | 'audio';
const MEDIA_LABEL: Record<MediaKind, string> = { image: 'Start image', endImage: 'Last frame', audio: 'Voice clip' };

function MediaButton({ kind, required, uploading, fileName, onPick, onClear, testId }: {
  kind: MediaKind; required: boolean; uploading: boolean; fileName: string | null;
  onPick: (f: File) => void; onClear: () => void; testId: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const label = MEDIA_LABEL[kind];
  return (
    <div className="flex items-center gap-2">
      {fileName ? (
        <button type="button" onClick={onClear} title={`Remove ${label.toLowerCase()} (${fileName})`}
          className={`${PROMPT_MEDIA_PREVIEW_CLASS} flex items-center justify-center bg-[#d1fe17]/10 text-[#d1fe17]`}>
          {kind !== 'audio'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>}
        </button>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} title={`${uploading ? 'Uploading' : 'Add'} ${label.toLowerCase()}${required ? ' (required)' : ' (optional)'}`}
          className={promptMediaButtonClassName({ active: required })}>
          {uploading
            ? <span className="animate-spin text-[#d1fe17]">◌</span>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white/60 group-hover:text-[#d1fe17]"><path d="M12 5v14M5 12h14" /></svg>}
        </button>
      )}
      <span className="max-w-[140px] truncate text-[11px] font-semibold text-white/45">{fileName ?? `${label}${required ? ' *' : ''}`}</span>
      <input ref={ref} type="file" className="hidden" data-testid={testId}
        accept={kind === 'audio' ? 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a' : 'image/png,image/jpeg,image/webp'}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }} />
    </div>
  );
}

function Hero({ model, gallery }: { model: ModelInfo | null; gallery: GalleryItem[] }) {
  const thumbs = gallery.slice(0, 4);
  const shapes = ['rounded-2xl -rotate-[12deg]', 'rounded-2xl -rotate-[4deg] -ml-4', 'rounded-full rotate-[6deg] -ml-4', 'rounded-2xl rotate-[12deg] -ml-4'];
  return (
    <div className="flex flex-col items-center px-4 text-center" data-testid="studio-hero">
      <div className="mb-8 flex items-center justify-center">
        {shapes.map((shape, i) => {
          const item = thumbs[i];
          return (
            <div key={shape} className={`h-24 w-20 flex-shrink-0 overflow-hidden border border-white/10 bg-gradient-to-br from-[#d1fe17]/15 via-white/[0.03] to-purple-500/15 shadow-2xl transition-all duration-300 hover:z-20 hover:rotate-0 hover:scale-110 sm:h-28 sm:w-24 ${shape}`}>
              {item ? (
                item.mediaType === 'video'
                  ? <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  : <img src={item.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[#d1fe17]/60">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <h1 className="mb-4 flex flex-col items-center font-extrabold tracking-tight">
        <span className="mb-1 text-xl font-black uppercase tracking-wide text-white opacity-90 sm:text-3xl">Start creating with</span>
        <span className="text-2xl font-black uppercase tracking-tight text-[#d1fe17] sm:mt-1 sm:text-4xl" data-testid="hero-model">{model?.name ?? 'a local model'}</span>
      </h1>
      <p className="max-w-lg text-xs font-medium leading-relaxed tracking-wide text-white/40 sm:text-sm">
        {model?.description || 'Download a model on the Models page, then describe your video below.'}
      </p>
      {model && model.availability.status !== 'installed' && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[12px] text-white/50" data-testid="status-detail">
          <StatusBadge status={model.availability.status} detail={model.availability.detail} />
          {model.availability.status === 'missing' && <Link href="/local/models" className="font-semibold text-[#d1fe17] hover:underline">Download it on the Models page</Link>}
          {model.availability.status === 'unreachable' && <span>{model.backend === 'comfyui' ? 'ComfyUI' : 'Wan2GP'} is not running.</span>}
        </div>
      )}
    </div>
  );
}

export default function LocalVideoStudio({ mediaType = 'video', onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError }: Props) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelId, setModelId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('');
  const [quality, setQuality] = useState<Quality | null>(null);
  const [seed, setSeed] = useState('');
  const [steps, setSteps] = useState('');
  const [frames, setFrames] = useState('');
  const [menu, setMenu] = useState<Menu>(null);
  const [image, setImage] = useState<{ id: string; name: string } | null>(null);
  const [endImage, setEndImage] = useState<{ id: string; name: string } | null>(null);
  const [audio, setAudio] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState<MediaKind | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const stopWatching = useRef<(() => void) | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => models?.find((m) => m.id === modelId) ?? null, [models, modelId]);

  const loadModels = useCallback(async () => {
    try {
      const [all, settings] = await Promise.all([api.models(), api.settings().catch(() => null)]);
      const list = all.filter((m) => m.type === mediaType && LOCAL_BACKENDS.includes(m.backend));
      setModels(list);
      // First choice: keep the current selection, else an installed model of the default
      // backend, else any installed model, else the first one.
      const installed = list.filter((m) => m.availability.status === 'installed');
      const preferred = installed.find((m) => m.backend === settings?.defaultBackend) ?? installed[0] ?? list.find((m) => m.backend === settings?.defaultBackend) ?? list[0];
      setModelId((current) => (current && list.some((m) => m.id === current) ? current : preferred?.id ?? ''));
    } catch (err) {
      setError((err as Error).message);
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

  // Close menus on outside click.
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!controlsRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  // Keep options valid for the selected model.
  useEffect(() => {
    if (!model) return;
    const first = model.video?.sizes[0];
    setQuality(first?.quality ?? null);
    setAspectRatio(first?.ratio ?? model.aspectRatios[0] ?? '');
    setFrames('');
    if (model.inputs.image === 'none') setImage(null);
    if (model.inputs.endImage === 'none') setEndImage(null);
    if (model.inputs.audio === 'none') setAudio(null);
  }, [model]);

  const busy = job !== null && !TERMINAL.includes(job.status);
  const missingInput = model && ((model.inputs.image === 'required' && !image) || (model.inputs.endImage === 'required' && !endImage) || (model.inputs.audio === 'required' && !audio));
  const canGenerate = Boolean(model && prompt.trim() && !missingInput && !busy && !uploading);

  const upload = async (kind: MediaKind, file: File) => {
    setUploading(kind);
    setError(null);
    try {
      const saved = await api.upload(file);
      const expected = kind === 'audio' ? 'audio' : 'image';
      if (saved.kind !== expected) throw new Error(`That file is ${saved.kind === 'image' ? 'an image' : 'audio'}, not ${expected === 'image' ? 'an image' : 'audio'}.`);
      ({ image: setImage, endImage: setEndImage, audio: setAudio })[kind]({ id: saved.id, name: file.name });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  };

  const generate = async () => {
    if (!model) return;
    setError(null);
    setMenu(null);
    try {
      const submitted = await api.submitJob({
        modelId: model.id,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        aspectRatio: aspectRatio || undefined,
        quality: quality ?? undefined,
        seed: toInt(seed),
        steps: toInt(steps),
        frames: toInt(frames),
        imageUploadId: image?.id,
        endImageUploadId: endImage?.id,
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
  const toggle = (name: Exclude<Menu, null>) => () => setMenu((m) => (m === name ? null : name));
  const settingsChanged = Boolean(negativePrompt || seed || steps || frames);

  return (
    <div className="relative flex h-full w-full flex-col items-center overflow-hidden bg-[#030303]" data-testid="local-video-studio" data-media-type={mediaType}>
      {/* Result area: hero until the first generation, then the job and recent outputs. */}
      <div className="w-full flex-1 overflow-y-auto px-4 pb-72 pt-10 md:px-8">
        {job ? (
          <div className="mx-auto max-w-4xl space-y-6">
            <div className="rounded-2xl border border-white/[0.06] bg-[#0a0a0b] p-5" data-testid="job-card" data-status={job.status}>
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
                  ? <img src={resultUrl} alt={job.params.prompt} className="mt-3 max-h-[55vh] w-full rounded-xl object-contain" />
                  : <video src={resultUrl} controls autoPlay loop muted playsInline className="mt-3 max-h-[55vh] w-full rounded-xl bg-black" data-testid="result-video" />
              )}
            </div>

            {gallery.length > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold text-white/80">Recent outputs</h2>
                  <Link href="/local/gallery" className="text-[12px] text-[#d1fe17] hover:underline">Open gallery</Link>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" data-testid="recent-outputs">
                  {gallery.map((item) => (
                    <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-white/[0.06] bg-black">
                      {item.mediaType === 'video'
                        ? <video src={item.url} muted playsInline preload="metadata" className="aspect-video w-full object-cover" />
                        : <img src={item.url} alt={item.prompt ?? ''} className="aspect-video w-full object-cover" />}
                      <div className="truncate px-2 py-1.5 text-[11px] text-white/50 group-hover:text-white/80">{item.prompt ?? item.id}</div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-full items-center justify-center">
            <Hero model={model} gallery={gallery} />
          </div>
        )}
      </div>

      {/* Bottom prompt bar */}
      <PromptComposer>
        {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300" data-testid="error">{error}</div>}
        <div className="flex flex-col gap-3">
          {model && (model.inputs.image !== 'none' || model.inputs.endImage !== 'none' || model.inputs.audio !== 'none') && (
            <div className="flex flex-wrap items-center gap-4">
              {model.inputs.image !== 'none' && (
                <MediaButton kind="image" required={model.inputs.image === 'required'} uploading={uploading === 'image'} fileName={image?.name ?? null}
                  onPick={(f) => void upload('image', f)} onClear={() => setImage(null)} testId="image-input" />
              )}
              {model.inputs.endImage !== 'none' && (
                <MediaButton kind="endImage" required={model.inputs.endImage === 'required'} uploading={uploading === 'endImage'} fileName={endImage?.name ?? null}
                  onPick={(f) => void upload('endImage', f)} onClear={() => setEndImage(null)} testId="end-image-input" />
              )}
              {model.inputs.audio !== 'none' && (
                <MediaButton kind="audio" required={model.inputs.audio === 'required'} uploading={uploading === 'audio'} fileName={audio?.name ?? null}
                  onPick={(f) => void upload('audio', f)} onClear={() => setAudio(null)} testId="audio-input" />
              )}
            </div>
          )}
          <PromptTextarea
            data-testid="prompt"
            aria-label="Prompt"
            value={prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canGenerate) void generate();
            }}
            maxLength={4000}
            placeholder={mediaType === 'video' ? 'Describe the video you want to create' : 'Describe the image you want to create'}
          />
        </div>

        <PromptFooter>
          <PromptControls ref={controlsRef}>
            {/* Model */}
            <div className="relative">
              <button type="button" onClick={toggle('model')} data-testid="model-picker" className={promptControlClassName({ active: menu === 'model' })}>
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${model?.availability.status === 'installed' ? 'bg-[#d1fe17]' : model?.availability.status === 'missing' ? 'bg-amber-400' : 'bg-white/25'}`} />
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{model?.name ?? (models === null ? 'Loading models…' : 'No local models')}</span>
                <PromptChevronIcon />
              </button>
              {menu === 'model' && (
                <PromptPopover className="w-[calc(100vw-2rem)] max-w-md overflow-x-hidden md:w-[460px]">
                  <PromptPopoverHeader>Local models</PromptPopoverHeader>
                  <PromptMenuList>
                    {models?.map((m) => (
                      <div key={m.id} className="flex min-w-0 items-center gap-2" data-testid={`model-${m.id}`}>
                        {/* The name shrinks (ellipsis, full name on hover); the badge keeps its size. */}
                        <div className="min-w-0 flex-1" title={m.name}>
                        <PromptMenuItem
                          selected={m.id === modelId}
                          description={`${BACKEND_LABEL[m.backend]}${m.experimental ? ' · experimental' : ''}`}
                          onClick={() => {
                            setModelId(m.id);
                            setMenu(null);
                          }}
                        >
                          {m.name}
                        </PromptMenuItem>
                        </div>
                        <span className="flex-shrink-0"><StatusBadge status={m.availability.status} detail={m.availability.detail} /></span>
                      </div>
                    ))}
                  </PromptMenuList>
                  <Link href="/local/models" className="mt-2 block border-t border-white/[0.05] px-3 pt-2 text-[11px] font-semibold text-[#d1fe17] hover:underline">Download or remove models</Link>
                </PromptPopover>
              )}
            </div>

            {/* Quality (480p … 1080p): only sizes the model supports */}
            {model?.video && (
              <div className="relative">
                <button type="button" onClick={qualities(model).length > 1 ? toggle('quality') : undefined} data-testid="quality-picker"
                  className={promptControlClassName({ active: menu === 'quality', compact: true })}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60"><path d="M6 3h12l4 6-10 12L2 9z" /><path d="M2 9h20" /></svg>
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{quality}</span>
                  {qualities(model).length > 1 && <PromptChevronIcon />}
                </button>
                {menu === 'quality' && (
                  <PromptPopover>
                    <PromptPopoverHeader>Quality</PromptPopoverHeader>
                    <PromptMenuList>
                      {qualities(model).map((q) => (
                        <PromptMenuItem key={q} selected={q === quality} data-testid={`quality-${q}`}
                          description={ratiosFor(model, q).map((r) => sizeFor(model, q, r)).filter(Boolean).slice(0, 1).join('') + (ratiosFor(model, q).length > 1 ? ` · ${ratiosFor(model, q).length} ratios` : '')}
                          onClick={() => {
                            setQuality(q);
                            if (!ratiosFor(model, q).includes(aspectRatio)) setAspectRatio(ratiosFor(model, q)[0]);
                            setMenu(null);
                          }}>
                          {q}
                        </PromptMenuItem>
                      ))}
                    </PromptMenuList>
                    <p className="mt-2 px-1 text-[10px] leading-4 text-white/35">Higher quality needs more GPU memory and takes longer.</p>
                  </PromptPopover>
                )}
              </div>
            )}

            {/* Aspect ratio */}
            {model && ratiosFor(model, quality).length > 0 && (
              <div className="relative">
                <button type="button" onClick={ratiosFor(model, quality).length > 1 ? toggle('ratio') : undefined} data-testid="ratio-picker"
                  className={promptControlClassName({ active: menu === 'ratio', compact: true })}>
                  <PromptAspectRatioIcon />
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{aspectRatio}</span>
                  {ratiosFor(model, quality).length > 1 && <PromptChevronIcon />}
                </button>
                {menu === 'ratio' && (
                  <PromptPopover>
                    <PromptPopoverHeader>Aspect ratio</PromptPopoverHeader>
                    <PromptMenuList>
                      {ratiosFor(model, quality).map((r) => (
                        <PromptMenuItem key={r} selected={r === aspectRatio} data-testid={`ratio-${r}`} description={sizeFor(model, quality, r) ?? undefined}
                          onClick={() => { setAspectRatio(r); setMenu(null); }}>
                          {r}
                        </PromptMenuItem>
                      ))}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
            )}

            {/* Duration: frame counts the model accepts, shown in seconds */}
            {model?.video && (
              <div className="relative">
                <button type="button" onClick={toggle('duration')} data-testid="duration-picker"
                  className={promptControlClassName({ active: menu === 'duration', compact: true })}>
                  <PromptDurationIcon />
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>
                    {frames ? formatSeconds(Number(frames) / model.video.fps) : model.defaults.frames ? formatSeconds(model.defaults.frames / model.video.fps) : 'Default length'}
                  </span>
                  <PromptChevronIcon />
                </button>
                {menu === 'duration' && (
                  <PromptPopover className="min-w-[200px]">
                    <PromptPopoverHeader>Duration</PromptPopoverHeader>
                    <PromptMenuList>
                      {durationOptions(model).map((o) => (
                        <PromptMenuItem key={o.frames} data-testid={`duration-${o.frames}`}
                          selected={String(o.frames) === frames || (!frames && o.frames === model.defaults.frames)}
                          description={`${o.frames} frames at ${model.video!.fps} fps${o.frames === model.defaults.frames ? ' · default' : ''}`}
                          onClick={() => { setFrames(o.frames === model.defaults.frames ? '' : String(o.frames)); setMenu(null); }}>
                          {formatSeconds(o.seconds)}
                        </PromptMenuItem>
                      ))}
                    </PromptMenuList>
                    <p className="mt-2 px-1 text-[10px] leading-4 text-white/35">Longer videos need more GPU memory and take longer.</p>
                  </PromptPopover>
                )}
              </div>
            )}

            {/* Settings: frames, steps, seed, negative prompt */}
            <div className="relative">
              <button type="button" onClick={toggle('settings')} data-testid="settings-picker"
                className={promptControlClassName({ active: menu === 'settings' || settingsChanged, compact: true })}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="opacity-60"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
                <span className={PROMPT_CONTROL_LABEL_CLASS}>
                  {!model?.video && frames ? `${frames} frames` : !model?.video && model?.defaults.frames ? `${model.defaults.frames} frames` : 'Settings'}
                </span>
                <PromptChevronIcon />
              </button>
              {menu === 'settings' && (
                <PromptPopover className="w-[calc(100vw-2rem)] max-w-sm md:w-[340px]">
                  <PromptPopoverHeader>Settings</PromptPopoverHeader>
                  <div className="grid grid-cols-3 gap-2 px-1">
                    {([
                      ...(model?.video ? [] : [['Frames', frames, setFrames, model?.defaults.frames ? String(model.defaults.frames) : 'default'] as const]),
                      ['Steps', steps, setSteps, model?.defaults.steps ? String(model.defaults.steps) : 'default'] as const,
                      ['Seed', seed, setSeed, 'random'] as const,
                    ]).map(([label, value, setter, placeholder]) => (
                      <label key={label} className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                        {label}
                        <input inputMode="numeric" value={value} placeholder={placeholder} data-testid={`setting-${label.toLowerCase()}`}
                          onChange={(e) => setter(e.target.value.replace(/[^\d]/g, ''))}
                          className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[12px] normal-case text-white placeholder:text-white/25 focus:border-[#d1fe17]/50 focus:outline-none" />
                      </label>
                    ))}
                    <label className="col-span-3 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                      Negative prompt
                      <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} rows={2} maxLength={2000} placeholder="What to avoid"
                        className="mt-1 w-full resize-none rounded-md border border-white/10 bg-white/[0.03] p-2 text-[12px] normal-case text-white placeholder:text-white/25 focus:border-[#d1fe17]/50 focus:outline-none" />
                    </label>
                  </div>
                  <p className="mt-2 px-1 text-[10px] leading-4 text-white/35">Empty fields use the model&apos;s defaults.</p>
                </PromptPopover>
              )}
            </div>
          </PromptControls>

          <PromptAction data-testid="generate" disabled={!canGenerate} onClick={() => void generate()}>
            {busy ? (<><span className="inline-block animate-spin text-black">◌</span> Generating…</>) : <span>Generate</span>}
          </PromptAction>
        </PromptFooter>
      </PromptComposer>
    </div>
  );
}
