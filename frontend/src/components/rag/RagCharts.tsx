/**
 * RAG Charts Component
 *
 * PROMPT #90 - RAG Monitoring & Code Indexing Frontend
 *
 * Visualizes RAG hit rate distribution across usage types using recharts.
 * Pie chart shows relative performance for each usage type with color-coded segments.
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { RagUsageTypeStats } from '@/lib/types';

interface Props {
  usageTypes: RagUsageTypeStats[];
}

export function RagHitRatePieChart({ usageTypes }: Props) {
  const data = usageTypes.map(ut => ({
    name: ut.usage_type.replace(/_/g, ' '),
    value: ut.hit_rate,
    hits: ut.hits,
    total: ut.total
  }));

  const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hit Rate by Usage Type</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={(entry) => `${entry.name}: ${entry.value.toFixed(1)}%`}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string, props: any) => [
                `${value.toFixed(1)}% (${props.payload.hits}/${props.payload.total})`,
                name
              ]}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
