import ModeChooser from '@/components/ModeChooser';

export const metadata = {
  title: 'Zellijfield AI',
};

// Zellijfield AI: every visit starts by choosing the Local or the API-key dashboard.
export default function Home() {
  return <ModeChooser />;
}
