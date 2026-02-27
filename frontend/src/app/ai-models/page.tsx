'use client';

import { redirect } from 'next/navigation';

export default function AIModelsPage() {
  redirect('/ai-flow?tab=models');
}
