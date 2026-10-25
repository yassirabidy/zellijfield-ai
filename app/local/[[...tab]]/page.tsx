import { notFound } from 'next/navigation';
import type { LocalTab } from '@/components/local/LocalShell';
import LocalShell from '@/components/local/LocalShell';

export const metadata = {
  title: 'Local studio — Zellijfield AI',
};

const TABS: LocalTab[] = ['video', 'image', 'gallery', 'settings'];

export default async function LocalPage({ params }: { params: Promise<{ tab?: string[] }> }) {
  const { tab = [] } = await params;
  const name = (tab[0] ?? 'video') as LocalTab;
  if (tab.length > 1 || !TABS.includes(name)) notFound();
  return <LocalShell tab={name} />;
}
