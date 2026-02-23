/**
 * Contracts Page - Redirect to AI Flow
 *
 * PROMPT #257 - Contracts moved to database + visual nodes in AI Flow.
 * This page now redirects to /ai-flow where contracts are managed visually.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ContractsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/ai-flow');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-500">Redirecionando para AI Flow...</p>
      </div>
    </div>
  );
}
