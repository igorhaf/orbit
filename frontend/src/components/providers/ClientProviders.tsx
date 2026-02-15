'use client';

/**
 * ClientProviders - Client-side providers wrapper
 * PROMPT #128 - Wraps all client-side contexts/providers
 *
 * This component wraps the app with all necessary client-side providers
 * while keeping the root layout as a Server Component.
 */

import { NotificationProvider } from '@/contexts/NotificationContext';

interface Props {
  children: React.ReactNode;
}

export function ClientProviders({ children }: Props) {
  return (
    <NotificationProvider>
      {children}
    </NotificationProvider>
  );
}
