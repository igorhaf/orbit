/**
 * RAG Usage Type Performance Table
 *
 * PROMPT #90 - RAG Monitoring & Code Indexing Frontend
 *
 * Displays detailed breakdown of RAG performance by usage type:
 * - task_execution: Code generation during task execution
 * - interview: Context during interview questions
 * - prompt_generation: Background context when generating prompts
 * - commit_generation: Context for commit message generation
 * - general: Other AI operations
 *
 * Includes color-coded hit rates for quick visual assessment.
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { RagUsageTypeStats } from '@/lib/types';

interface Props {
  usageTypes: RagUsageTypeStats[];
}

export function RagUsageTypeTable({ usageTypes }: Props) {
  const getHitRateColor = (rate: number) => {
    if (rate >= 70) return 'bg-green-100 text-green-700';
    if (rate >= 50) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  const getUsageTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'task_execution': 'Task Execution',
      'interview': 'Interview',
      'prompt_generation': 'Prompt Generation',
      'commit_generation': 'Commit Generation',
      'general': 'General'
    };
    return labels[type] || type;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance by Usage Type</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3">Usage Type</th>
                <th className="text-right p-3">Total</th>
                <th className="text-right p-3">Hits</th>
                <th className="text-right p-3">Hit Rate</th>
                <th className="text-right p-3">Avg Similarity</th>
                <th className="text-right p-3">Avg Latency</th>
              </tr>
            </thead>
            <tbody>
              {usageTypes.map((ut) => (
                <tr key={ut.usage_type} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">
                    {getUsageTypeLabel(ut.usage_type)}
                  </td>
                  <td className="text-right p-3">{ut.total}</td>
                  <td className="text-right p-3">{ut.hits}</td>
                  <td className="text-right p-3">
                    <Badge className={getHitRateColor(ut.hit_rate)}>
                      {ut.hit_rate.toFixed(1)}%
                    </Badge>
                  </td>
                  <td className="text-right p-3">
                    {ut.avg_top_similarity.toFixed(3)}
                  </td>
                  <td className="text-right p-3">
                    {ut.avg_retrieval_time_ms.toFixed(0)}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
