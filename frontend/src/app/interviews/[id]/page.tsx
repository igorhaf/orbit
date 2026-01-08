/**
 * Interview Detail Page (Legacy URL - Redirects to new structure)
 * Old URL: /interviews/{id}
 * New URL: /projects/{projectId}/interviews/{interviewId}
 *
 * This page exists for backward compatibility and redirects to the new hierarchical structure.
 */

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { interviewsApi } from '@/lib/api';
import { Layout } from '@/components/layout';

export default function InterviewLegacyRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const interviewId = params.id as string;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const redirectToNewUrl = async () => {
      try {
        // Fetch interview to get project_id
        const interview = await interviewsApi.get(interviewId);

        // Redirect to new hierarchical URL
        router.replace(`/projects/${interview.project_id}/interviews/${interviewId}`);
      } catch (err: any) {
        console.error('Failed to redirect interview:', err);
        setError(err.message || 'Failed to load interview');
      }
    };

    redirectToNewUrl();
  }, [interviewId, router]);

  if (error) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-96">
          <div className="text-red-600 mb-4">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Interview Not Found</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.push('/projects')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Back to Projects
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col items-center justify-center h-96">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-600">Redirecting to interview...</p>
      </div>
    </Layout>
  );
}
