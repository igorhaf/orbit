/**
 * Interviews Page
 * List all interviews and create new ones
 */

'use client';

import { Layout, Breadcrumbs } from '@/components/layout';
import { InterviewList } from '@/components/interview';

export default function InterviewsPage() {
  return (
    <Layout>
      <Breadcrumbs />
      <InterviewList />
    </Layout>
  );
}
