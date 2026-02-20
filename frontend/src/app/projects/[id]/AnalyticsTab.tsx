'use client';

/**
 * AnalyticsTab - Blocking Analytics Tab Component
 * Extracted from project detail page (PROMPT #232)
 * Shows blocking analytics: metrics cards, similarity distribution, resolution rates, timeline
 */

import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { BlockingAnalytics } from '@/lib/types';

interface AnalyticsTabProps {
  loadingAnalytics: boolean;
  analyticsData: BlockingAnalytics | null;
  analyticsDays: number;
  setAnalyticsDays: (days: number) => void;
}

export default function AnalyticsTab({
  loadingAnalytics,
  analyticsData,
  analyticsDays,
  setAnalyticsDays,
}: AnalyticsTabProps) {
  return (
    <div className="space-y-6">
      {/* Time Period Selector */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">Análise do Sistema de Bloqueios</h3>
        <div className="flex gap-2">
          {[7, 30, 90, 365].map((days) => (
            <Button
              key={days}
              variant={analyticsDays === days ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setAnalyticsDays(days)}
            >
              {days === 365 ? 'Todo Período' : `${days}d`}
            </Button>
          ))}
        </div>
      </div>

      {loadingAnalytics ? (
        <div className="flex items-center justify-center py-12">
          <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : analyticsData ? (
        <>
          {/* Key Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-gray-500">Atualmente Bloqueados</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline">
                  <span className="text-3xl font-bold text-red-600">{analyticsData.total_blocked}</span>
                  <span className="ml-2 text-sm text-gray-500">tarefas</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Pendente de aprovacao do usuário</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-gray-500">Aprovados</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline">
                  <span className="text-3xl font-bold text-green-600">{analyticsData.total_approved}</span>
                  <span className="ml-2 text-sm text-gray-500">modificacoes</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{(analyticsData.approval_rate * 100).toFixed(1)}% taxa de aprovacao</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-gray-500">Rejeitados</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline">
                  <span className="text-3xl font-bold text-orange-600">{analyticsData.total_rejected}</span>
                  <span className="ml-2 text-sm text-gray-500">modificacoes</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{(analyticsData.rejection_rate * 100).toFixed(1)}% taxa de rejeicao</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-gray-500">Similaridade Media</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline">
                  <span className="text-3xl font-bold text-blue-600">{(analyticsData.avg_similarity_score * 100).toFixed(1)}%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Precisao de detecção da IA</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Similarity Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Distribuicao de Pontuacao de Similaridade</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(analyticsData.similarity_distribution).map(([range, count]) => {
                    const total = Object.values(analyticsData.similarity_distribution).reduce((a, b) => a + b, 0);
                    const percentage = total > 0 ? (count / total) * 100 : 0;

                    const getColor = (range: string) => {
                      if (range === '90+') return 'bg-red-500';
                      if (range === '80-90') return 'bg-orange-500';
                      if (range === '70-80') return 'bg-yellow-500';
                      return 'bg-green-500';
                    };

                    return (
                      <div key={range}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-gray-700">{range}% Similares</span>
                          <span className="text-gray-500">{count} ({percentage.toFixed(0)}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div
                            className={`h-3 rounded-full ${getColor(range)}`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Approval vs Rejection Rate */}
            <Card>
              <CardHeader>
                <CardTitle>Taxa de Resolução</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-green-700">Aprovados</span>
                      <span className="text-gray-500">{analyticsData.total_approved} ({(analyticsData.approval_rate * 100).toFixed(1)}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-6">
                      <div
                        className="h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-semibold"
                        style={{ width: `${analyticsData.approval_rate * 100}%` }}
                      >
                        {analyticsData.approval_rate > 0.15 && `${(analyticsData.approval_rate * 100).toFixed(0)}%`}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-orange-700">Rejeitados</span>
                      <span className="text-gray-500">{analyticsData.total_rejected} ({(analyticsData.rejection_rate * 100).toFixed(1)}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-6">
                      <div
                        className="h-6 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-semibold"
                        style={{ width: `${analyticsData.rejection_rate * 100}%` }}
                      >
                        {analyticsData.rejection_rate > 0.15 && `${(analyticsData.rejection_rate * 100).toFixed(0)}%`}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t">
                    <div className="text-sm text-gray-600">
                      <strong>Total Resolvidos:</strong> {analyticsData.total_approved + analyticsData.total_rejected} modificacoes
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      <strong>Taxa de Bloqueio:</strong> {(analyticsData.blocking_rate * 100).toFixed(1)}% de todas as tarefas
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Timeline */}
          {analyticsData.blocked_by_date && analyticsData.blocked_by_date.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Linha do Tempo de Bloqueios</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analyticsData.blocked_by_date.slice(0, 10).map((item) => (
                    <div key={item.date} className="flex justify-between items-center py-2 border-b last:border-0">
                      <span className="text-sm font-medium text-gray-700">{new Date(item.date).toLocaleDateString()}</span>
                      <Badge variant="default">{item.count} bloqueados</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            <p>Nenhuma análise de bloqueios disponível ainda</p>
            <p className="text-sm mt-2">Análises aparecerao apos a IA sugerir modificacoes nas tarefas</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
