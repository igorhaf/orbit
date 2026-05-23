/**
 * Contracts Page - Redirect to AI Flow
 *
 * PROMPT #257 - Contracts moved to database + visual nodes in AI Flow.
 * This page now redirects to /ai-flow where contracts are managed visually.
 */

'use client';

import { useEffect } from 'react';
import { Spinner } from '@/components/ui';
import { useRouter } from 'next/navigation';

export default function ContractsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/ai-flow');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <Spinner size="lg" />
        <p className="text-gray-500">Redirecionando para AI Flow...</p>
      </div>
    </div>
  );
}
