import { closestCorners, pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core';

export const boardCollisionDetection: CollisionDetection = (args) => {
  const sidebarTargets = args.droppableContainers.filter(container => ['inbox', 'collection'].includes(container.data.current?.type));
  if (args.active.data.current?.type === 'card') {
    const detectSidebar = args.pointerCoordinates ? pointerWithin : rectIntersection;
    const sidebarCollisions = detectSidebar({ ...args, droppableContainers: sidebarTargets });
    if (sidebarCollisions.length) return sidebarCollisions;
  }
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(container => !['inbox', 'collection'].includes(container.data.current?.type)),
  });
};
