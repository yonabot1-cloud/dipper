'use client';
import { useSession } from '@/lib/client';
import AuthScreen from '@/components/AuthScreen';
import Watchlist from '@/components/Watchlist';
import { Splash } from '@/components/Bits';

export default function Home() {
  const { loading, session, notReady } = useSession();
  if (loading) return <Splash />;
  if (notReady) return <Splash text="Dipper is getting set up. Check back in a few minutes." />;
  if (!session) return <AuthScreen />;
  return <Watchlist session={session} />;
}
