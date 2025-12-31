/**
 * Interview Detail Page
 * Chat interface for a specific interview
 */

'use client';

import { useParams } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { ChatInterface } from '@/components/interview';

export default function InterviewPage() {
  const params = useParams();
  const interviewId = params.id as string;

  return (
    <Layout>
      <Breadcrumbs />
      <ChatInterface
        interviewId={interviewId}
        onStatusChange={() => {
          // Optional: refresh interview list or show notification
        }}
      />
    </Layout>
  );
}
