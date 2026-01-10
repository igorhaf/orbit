/**
 * SimilarityBadge Component
 * PROMPT #95 - Blocking System UI
 *
 * Displays similarity score for blocked tasks (modification detection).
 * Shows percentage with color-coded badge (90%+ = red, high similarity).
 */

'use client';

import { Badge } from '@/components/ui';

interface Props {
  score: number; // 0.0 to 1.0
  className?: string;
}

export function SimilarityBadge({ score, className = '' }: Props) {
  const percentage = Math.round(score * 100);

  // Color coding:
  // 90-100%: Red (very high similarity - modification detected)
  // 80-89%: Orange (high similarity)
  // 70-79%: Yellow (moderate similarity)
  // <70%: Green (low similarity - unlikely to be a modification)
  const getBadgeColor = () => {
    if (percentage >= 90) {
      return 'bg-red-100 text-red-800 border-red-300';
    } else if (percentage >= 80) {
      return 'bg-orange-100 text-orange-800 border-orange-300';
    } else if (percentage >= 70) {
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    } else {
      return 'bg-green-100 text-green-800 border-green-300';
    }
  };

  // Icon based on severity
  const getIcon = () => {
    if (percentage >= 90) {
      return '🚨'; // Alert - modification detected
    } else if (percentage >= 80) {
      return '⚠️'; // Warning - high similarity
    } else if (percentage >= 70) {
      return '📊'; // Chart - moderate similarity
    } else {
      return '✅'; // Check - low similarity
    }
  };

  return (
    <Badge
      className={`${getBadgeColor()} font-semibold text-xs px-2 py-1 ${className}`}
      title={`Similarity score: ${percentage}% - ${percentage >= 90 ? 'Modification detected' : 'Similar task found'}`}
    >
      <span className="mr-1">{getIcon()}</span>
      {percentage}% Similar
    </Badge>
  );
}
