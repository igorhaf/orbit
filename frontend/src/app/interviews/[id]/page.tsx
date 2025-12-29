/**
 * Interview Detail Page
 * Chat interface for a specific interview
 */

'use client';

import { useParams, useRouter } from 'next/navigation';
import { Layout, Breadcrumbs } from '@/components/layout';
import { ChatInterface } from '@/components/interview';
import { Button } from '@/components/ui';

export default function InterviewPage() {
  const params = useParams();
  const router = useRouter();
  const interviewId = params.id as string;

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={() => router.push('/interviews')}
          leftIcon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          }
        >
          Back to Interviews
        </Button>

        <ChatInterface
          interviewId={interviewId}
          onStatusChange={() => {
            // Optional: refresh interview list or show notification
          }}
        />
      </div>
    </Layout>
  );
}
