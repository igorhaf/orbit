/**
 * /analytics/tokens redireciona pra /analytics unificado.
 * (Pagina antiga substituida pela versao combinada com custos.)
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TokensRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/analytics');
  }, [router]);
  return null;
}
