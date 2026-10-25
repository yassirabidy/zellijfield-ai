import type { Availability } from '@/lib/client/api';

const STYLES: Record<Availability, { label: string; className: string }> = {
  installed: { label: 'Installed', className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  missing: { label: 'Not found', className: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  unreachable: { label: 'Unreachable', className: 'bg-red-500/10 text-red-300 border-red-500/30' },
  'needs-key': { label: 'Needs key', className: 'bg-white/5 text-white/60 border-white/15' },
};

export default function StatusBadge({ status, detail }: { status: Availability; detail?: string }) {
  const s = STYLES[status];
  return (
    <span
      title={detail}
      data-testid={`status-${status}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}
