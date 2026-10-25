'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ModelInfo, PublicSettings } from '@/lib/client/api';
import { api } from '@/lib/client/api';
import StatusBadge from './StatusBadge';

type KeyName = keyof PublicSettings['keys'];

const KEY_INFO: Record<KeyName, { label: string; hint: string }> = {
  muapi: { label: 'Muapi', hint: 'Optional. Enables the cloud studios (images, Cloud video, lip sync, …).' },
  fal: { label: 'fal', hint: 'Optional. Used by fal models added to models.json.' },
  replicate: { label: 'Replicate', hint: 'Optional. Used by Replicate models added to models.json.' },
};

const BACKENDS = ['mock', 'wan2gp', 'comfyui', 'fal', 'replicate'] as const;

function Card({ title, children, description }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/[0.07] bg-[#0a0a0b] p-6">
      <h2 className="text-[15px] font-bold text-white">{title}</h2>
      {description && <p className="mt-1 text-[12px] leading-5 text-white/45">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const inputClass = 'w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white placeholder:text-white/25 focus:border-[#d1fe17]/50 focus:outline-none';

export type SettingsSection = 'backends' | 'models' | 'keys';

// embedded: rendered inside a dashboard (no page header). sections: which cards to show.
export default function SettingsPanel({ embedded = false, sections = ['backends', 'models', 'keys'] }: { embedded?: boolean; sections?: SettingsSection[] }) {
  const show = (s: SettingsSection) => sections.includes(s);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [wan2gpUrl, setWan2gpUrl] = useState('');
  const [comfyuiUrl, setComfyuiUrl] = useState('');
  const [defaultBackend, setDefaultBackend] = useState('mock');
  const [keyDrafts, setKeyDrafts] = useState<Record<KeyName, string>>({ muapi: '', fal: '', replicate: '' });
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const apply = (s: PublicSettings) => {
    setSettings(s);
    setWan2gpUrl(s.wan2gpUrl);
    setComfyuiUrl(s.comfyuiUrl);
    setDefaultBackend(s.defaultBackend);
  };

  const checkModels = useCallback(async () => {
    setChecking(true);
    try {
      setModels(await api.models());
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    api.settings().then(apply).catch((err) => setMessage({ kind: 'error', text: (err as Error).message }));
    if (sections.includes('models')) void checkModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkModels]);

  const saveBackends = async () => {
    setMessage(null);
    try {
      apply(await api.saveSettings({ wan2gpUrl: wan2gpUrl.trim(), comfyuiUrl: comfyuiUrl.trim(), defaultBackend }));
      setMessage({ kind: 'ok', text: 'Backend settings saved.' });
      void checkModels();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    }
  };

  const resetBackends = async () => {
    setMessage(null);
    try {
      apply(await api.saveSettings({ wan2gpUrl: null, comfyuiUrl: null }));
      setMessage({ kind: 'ok', text: 'Backend URLs reset to the defaults.' });
      void checkModels();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    }
  };

  const saveKey = async (name: KeyName, value: string) => {
    setMessage(null);
    try {
      apply(await api.saveSettings({ keys: { [name]: value } }));
      setKeyDrafts((d) => ({ ...d, [name]: '' }));
      setMessage({ kind: 'ok', text: value ? `${KEY_INFO[name].label} key saved on the server.` : `${KEY_INFO[name].label} key removed.` });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    }
  };

  return (
    <div className={embedded ? 'h-full overflow-y-auto bg-[#030303] text-white' : 'min-h-screen bg-[#030303] text-white'}>
      {!embedded && (
      <header className="flex h-14 items-center justify-between border-b border-white/[0.05] bg-[#0a0a0b]/80 px-5">
        <div className="flex items-center gap-3">
          <Link href="/studio" className="text-[13px] text-white/60 hover:text-white">← Cloud studio</Link>
          <span className="text-sm font-bold">Settings</span>
        </div>
      </header>
      )}


      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
        {message && (
          <div role={message.kind === 'error' ? 'alert' : 'status'} data-testid="settings-message"
            className={`rounded-lg border px-4 py-2.5 text-[13px] ${message.kind === 'ok' ? 'border-lime-500/30 bg-lime-500/10 text-lime-200' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
            {message.text}
          </div>
        )}

        {show('backends') && (
        <Card title="Local backends" description="Inside Docker these point at the compose services. Change them only to use a Wan2GP or ComfyUI running elsewhere on your network.">
          <div className="grid gap-4">
            <label className="block text-[12px] font-semibold text-white/60">
              Wan2GP MCP server URL
              <input className={`${inputClass} mt-1.5`} value={wan2gpUrl} onChange={(e) => setWan2gpUrl(e.target.value)} placeholder="http://wan2gp:7866/mcp" data-testid="wan2gp-url" />
              <span className="mt-1 block text-[11px] font-normal text-white/35">WanGP&apos;s MCP endpoint (wgp.py --mcp), not the Gradio web UI port.</span>
            </label>
            <label className="block text-[12px] font-semibold text-white/60">
              ComfyUI URL
              <input className={`${inputClass} mt-1.5`} value={comfyuiUrl} onChange={(e) => setComfyuiUrl(e.target.value)} placeholder="http://comfyui:8188" data-testid="comfyui-url" />
            </label>
            <label className="block text-[12px] font-semibold text-white/60">
              Default backend
              <select className={`${inputClass} mt-1.5`} value={defaultBackend} onChange={(e) => setDefaultBackend(e.target.value)}>
                {BACKENDS.map((b) => <option key={b} value={b} className="bg-[#0a0a0b]">{b}</option>)}
              </select>
            </label>
            <div className="flex gap-3">
              <button type="button" onClick={() => void saveBackends()} data-testid="save-backends" className="h-10 rounded-md bg-[#d1fe17] px-4 text-[13px] font-bold text-black hover:bg-[#b2d814]">Save</button>
              <button type="button" onClick={() => void checkModels()} className="h-10 rounded-md border border-white/10 px-4 text-[13px] font-semibold text-white/80 hover:text-white">
                {checking ? 'Checking…' : 'Test connections'}
              </button>
              <button type="button" onClick={() => void resetBackends()} className="h-10 rounded-md px-3 text-[12px] font-semibold text-white/50 hover:text-white">
                Reset to defaults
              </button>
            </div>
          </div>
        </Card>
        )}

        {show('models') && (
        <Card title="Models" description="Status of every model in models.json. Wan2GP downloads missing weights on first use; ComfyUI models need their files in models/comfyui.">
          {models === null ? (
            <p className="text-[13px] text-white/40">Checking…</p>
          ) : (
            <ul className="divide-y divide-white/[0.05]" data-testid="model-status-list">
              {models.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-white">{m.name}{m.experimental && <span className="ml-2 rounded bg-purple-500/15 px-1.5 text-[10px] text-purple-300">experimental</span>}</div>
                    <div className="text-[11px] text-white/40">{m.backend} · {m.id}</div>
                    {m.availability.detail && <div className="mt-1 text-[11px] leading-4 text-white/45">{m.availability.detail}</div>}
                  </div>
                  <StatusBadge status={m.availability.status} detail={m.availability.detail} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        )}

        {show('keys') && (
        <Card title="API keys" description="Keys are stored in this machine's data folder and used only by the server. They are never shown again, sent to the browser, or written to logs.">
          <div className="grid gap-5">
            {(Object.keys(KEY_INFO) as KeyName[]).map((name) => (
              <div key={name}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-white/70">{KEY_INFO[name].label}</span>
                  <span className={`text-[11px] font-semibold ${settings?.keys[name] ? 'text-lime-300' : 'text-white/35'}`} data-testid={`key-state-${name}`}>
                    {settings?.keys[name] ? 'Saved' : 'Not set'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input type="password" autoComplete="off" className={inputClass} value={keyDrafts[name]} data-testid={`key-input-${name}`}
                    onChange={(e) => setKeyDrafts((d) => ({ ...d, [name]: e.target.value }))}
                    placeholder={settings?.keys[name] ? 'Enter a new key to replace it' : 'Paste key'} />
                  <button type="button" disabled={!keyDrafts[name].trim()} onClick={() => void saveKey(name, keyDrafts[name].trim())}
                    className="h-[38px] rounded-md bg-white/10 px-4 text-[12px] font-semibold text-white hover:bg-white/15 disabled:opacity-40">Save</button>
                  {settings?.keys[name] && (
                    <button type="button" onClick={() => void saveKey(name, '')} className="h-[38px] rounded-md bg-red-500/10 px-3 text-[12px] font-semibold text-red-300 hover:bg-red-500/20">Remove</button>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-white/35">{KEY_INFO[name].hint}</p>
              </div>
            ))}
          </div>
        </Card>
        )}
      </main>
    </div>
  );
}
