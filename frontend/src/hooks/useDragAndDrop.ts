/**
 * Drag and Drop support for files and directories in Collective.
 *
 * Supports:
 * - Dragging files/dirs from one panel to another (copy/move)
 * - Dragging to the action queue (queue operations)
 * - Drag between the two sides of the comparison view
 * - External file drops (from OS file manager)
 */
import { useState, useCallback, useRef, type DragEvent } from "react";

export interface DragItem {
  type: "file" | "directory";
  path: string;
  name: string;
  size?: number;
  side?: "a" | "b"; // Which side of comparison it came from
}

export interface DropZone {
  id: string;
  accepts: ("file" | "directory")[];
  side?: "a" | "b";
  targetPath?: string;
}

interface DragAndDropState {
  isDragging: boolean;
  dragItem: DragItem | null;
  dragOverZone: string | null;
}

export function useDragAndDrop(onDrop?: (item: DragItem, zone: DropZone) => void) {
  const [state, setState] = useState<DragAndDropState>({
    isDragging: false,
    dragItem: null,
    dragOverZone: null,
  });

  const dragItemRef = useRef<DragItem | null>(null);

  const startDrag = useCallback((item: DragItem, e: DragEvent) => {
    dragItemRef.current = item;
    setState({ isDragging: true, dragItem: item, dragOverZone: null });

    // Set drag data for cross-component communication
    e.dataTransfer.setData("application/collective-item", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "copyMove";

    // Create a custom drag image
    const el = e.currentTarget as HTMLElement;
    if (el) {
      e.dataTransfer.setDragImage(el, 10, 10);
    }
  }, []);

  const handleDragOver = useCallback((zone: DropZone, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if the zone accepts this item type
    const item = dragItemRef.current;
    if (item && zone.accepts.includes(item.type)) {
      // Don't allow dropping on the same side
      if (zone.side && item.side && zone.side === item.side) {
        e.dataTransfer.dropEffect = "none";
        return;
      }
      e.dataTransfer.dropEffect = e.shiftKey ? "move" : "copy";
      setState((prev) => ({ ...prev, dragOverZone: zone.id }));
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setState((prev) => ({ ...prev, dragOverZone: null }));
  }, []);

  const handleDrop = useCallback(
    (zone: DropZone, e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Try to get item from data transfer (cross-component)
      let item = dragItemRef.current;
      if (!item) {
        try {
          const data = e.dataTransfer.getData("application/collective-item");
          if (data) {
            item = JSON.parse(data) as DragItem;
          }
        } catch {
          // Not a collective drag item
        }
      }

      // Handle external file drops
      if (!item && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0]!;
        item = {
          type: "file" as const,
          path: (file as File & { path?: string }).path || file.name,
          name: file.name,
          size: file.size,
        };
      }

      if (item && zone.accepts.includes(item.type)) {
        onDrop?.(item, zone);
      }

      setState({ isDragging: false, dragItem: null, dragOverZone: null });
      dragItemRef.current = null;
    },
    [onDrop]
  );

  const endDrag = useCallback(() => {
    setState({ isDragging: false, dragItem: null, dragOverZone: null });
    dragItemRef.current = null;
  }, []);

  // Helper to make an element draggable
  const makeDraggable = useCallback(
    (item: DragItem) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => startDrag(item, e),
      onDragEnd: endDrag,
      className: "cursor-grab active:cursor-grabbing",
    }),
    [startDrag, endDrag]
  );

  // Helper to make an element a drop zone
  const makeDropZone = useCallback(
    (zone: DropZone) => ({
      onDragOver: (e: DragEvent) => handleDragOver(zone, e),
      onDragLeave: handleDragLeave,
      onDrop: (e: DragEvent) => handleDrop(zone, e),
      "data-drop-active": state.dragOverZone === zone.id,
    }),
    [handleDragOver, handleDragLeave, handleDrop, state.dragOverZone]
  );

  return {
    ...state,
    startDrag,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    endDrag,
    makeDraggable,
    makeDropZone,
  };
}
