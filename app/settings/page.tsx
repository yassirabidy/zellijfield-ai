import SettingsPanel from '@/components/local/SettingsPanel';

export const metadata = {
  title: 'API keys — Zellijfield AI',
};

// Settings of the API-key dashboard: the keys only. Local backends live in /local/settings.
export default function SettingsPage() {
  return <SettingsPanel sections={['keys']} />;
}
