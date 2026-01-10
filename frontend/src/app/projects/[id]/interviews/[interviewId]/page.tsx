/**
 * Interview Detail Page (Project-Scoped)
 * Chat interface for a specific interview within a project context
 * URL: /projects/{projectId}/interviews/{interviewId}
 */

'use client';

import { useParams } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { ChatInterface } from '@/components/interview';

export default function InterviewPage() {
  const params = useParams();
  const projectId = params.id as string;
  const interviewId = params.interviewId as string;

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
