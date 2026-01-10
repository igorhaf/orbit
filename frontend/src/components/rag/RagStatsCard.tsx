/**
 * RAG Statistics Cards Component
 *
 * PROMPT #90 - RAG Monitoring & Code Indexing Frontend
 *
 * Displays key RAG metrics in a grid of stat cards:
 * - Hit Rate: Percentage of RAG-enabled calls that found relevant results
 * - Avg Similarity: Average relevance score of top matches
 * - Avg Latency: Average retrieval time in milliseconds
 * - Avg Results: Average number of documents retrieved per query
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui';
import { TrendingUp, Clock, Database, Target } from 'lucide-react';
import { RagStats } from '@/lib/types';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  subtitle?: string;
  color?: string;
}

export function StatCard({ title, value, icon, subtitle, color = 'blue' }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">{title}</p>
            <p className={`text-3xl font-bold text-${color}-600 mt-2`}>
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
            )}
          </div>
          <div className={`p-3 bg-${color}-100 rounded-lg`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface RagStatsCardProps {
  stats: RagStats;
}

export function RagStatsCard({ stats }: RagStatsCardProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard
        title="Hit Rate"
        value={`${stats.hit_rate.toFixed(1)}%`}
        icon={<Target className="w-6 h-6 text-green-600" />}
        subtitle={`${stats.total_rag_hits} / ${stats.total_rag_enabled} hits`}
        color="green"
      />

      <StatCard
        title="Avg Similarity"
        value={stats.avg_top_similarity.toFixed(3)}
        icon={<TrendingUp className="w-6 h-6 text-blue-600" />}
        subtitle="Top match relevance"
        color="blue"
      />

      <StatCard
        title="Avg Latency"
        value={`${stats.avg_retrieval_time_ms.toFixed(0)}ms`}
        icon={<Clock className="w-6 h-6 text-purple-600" />}
        subtitle="Retrieval speed"
        color="purple"
      />

      <StatCard
        title="Avg Results"
        value={stats.avg_results_count.toFixed(1)}
        icon={<Database className="w-6 h-6 text-indigo-600" />}
        subtitle="Documents retrieved"
        color="indigo"
      />
    </div>
  );
}
