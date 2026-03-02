/**
 * Projects Page — Redirect to Home
 * Projects are now displayed at / (root). This redirect preserves bookmarks.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProjectsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return null;
}
