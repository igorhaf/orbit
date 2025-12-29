/**
 * CostMetrics Component
 * Display execution cost statistics
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';

interface Props {
  totalCost: number;
  estimatedCost: number;
  completedTasks: number;
  totalTasks: number;
}

export function CostMetrics({
  totalCost,
  estimatedCost,
  completedTasks,
  totalTasks,
}: Props) {
  const avgCostPerTask = completedTasks > 0 ? totalCost / completedTasks : 0;
  const remainingTasks = totalTasks - completedTasks;
  const projectedTotal = totalCost + remainingTasks * avgCostPerTask;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {/* Total Cost */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-600">
            Total Cost
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-gray-900">
            ${totalCost.toFixed(4)}
          </div>
          <p className="text-xs text-gray-500 mt-1">Actual spend</p>
        </CardContent>
      </Card>

      {/* Estimated Cost */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-600">
            Estimated Total
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-gray-900">
            ${estimatedCost.toFixed(4)}
          </div>
          <p className="text-xs text-gray-500 mt-1">Initial estimate</p>
        </CardContent>
      </Card>

      {/* Projected Cost */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-600">
            Projected Total
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">
            ${projectedTotal.toFixed(4)}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Based on avg ${avgCostPerTask.toFixed(4)}/task
          </p>
        </CardContent>
      </Card>

      {/* Efficiency */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-600">
            Efficiency
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              totalCost <= estimatedCost ? 'text-green-600' : 'text-orange-600'
            }`}
          >
            {estimatedCost > 0
              ? ((totalCost / estimatedCost) * 100).toFixed(1)
              : '0.0'}
            %
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {totalCost <= estimatedCost ? 'Under budget' : 'Over budget'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
