/**
 * Test Page for @hello-pangea/dnd
 * Simple test to verify the module can be imported
 */

'use client';

import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

export default function TestDndPage() {
  const handleDragEnd = () => {
    console.log('Drag ended');
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Testing @hello-pangea/dnd Import</h1>

      <div className="space-y-4">
        <div className="bg-green-100 p-4 rounded">
          <p className="font-medium">✅ Module Import Status:</p>
          <ul className="mt-2 space-y-1">
            <li>DragDropContext: {DragDropContext ? '✅ Imported' : '❌ Failed'}</li>
            <li>Droppable: {Droppable ? '✅ Imported' : '❌ Failed'}</li>
            <li>Draggable: {Draggable ? '✅ Imported' : '❌ Failed'}</li>
          </ul>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="bg-blue-100 p-4 rounded">
            <p className="font-medium mb-2">Simple Drag Test:</p>
            <Droppable droppableId="test">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="bg-white p-4 rounded min-h-[100px]"
                >
                  <Draggable draggableId="item-1" index={0}>
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className="bg-gray-200 p-3 rounded cursor-grab"
                      >
                        Drag me!
                      </div>
                    )}
                  </Draggable>
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        </DragDropContext>

        <div className="bg-yellow-100 p-4 rounded">
          <p className="font-medium">Instructions:</p>
          <ol className="mt-2 space-y-1 list-decimal list-inside">
            <li>If you see ✅ for all imports, the module is working!</li>
            <li>Try dragging the "Drag me!" box above</li>
            <li>If it works here, the Kanban should work too</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
