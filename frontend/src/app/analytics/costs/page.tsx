/**
 * /analytics/costs redireciona pra /analytics unificado.
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CostsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/analytics');
  }, [router]);
  return null;
}
