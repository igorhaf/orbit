'use client';
import { usePluginAvailability } from '@/lib/plugin-availability';

export function useCreationAvailability() {
  const { enabled,boardCreators } = usePluginAvailability();
  return {
    boardCreators,
    canCreateBoard: enabled('project-boards', 'boards.write'),
    canCreateProject: enabled('project-boards', 'projects.write'),
  };
}
