import type {Card} from '@/lib/api';
export function CardBadges({badges}:{badges:Card['plugin_badges']}){
 return <span className="flex flex-wrap gap-1">{badges?.map(badge=><span key={badge.pluginId+badge.field} className={'rounded px-2 py-0.5 text-xs font-semibold '+(badge.color==='purple'?'bg-purple-100 text-purple-900':badge.color==='blue'?'bg-blue-100 text-blue-900':'bg-gray-100 text-gray-800')}>{badge.label}</span>)}</span>;
}
