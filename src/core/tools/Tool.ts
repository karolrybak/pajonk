import { WebPhysics } from '../../webPhysics';
import { Renderer } from '../Renderer';
import type { Entity } from '../../ecs';
import type { PlacementState, ToolMode } from '../../types';

export interface IEditorEngine {
    physics: WebPhysics;
    renderer: Renderer;
    placement: PlacementState;
    tool: ToolMode;
    draggedEntity: Entity | null;
    dragOffset: Float32Array;
    selectedEntity: Entity | null;
    onSelectEntity?: (ent: Entity | null) => void;
    onRopeStateChange?: () => void;
}

export abstract class Tool {
    constructor(public engine: IEditorEngine) {}
    onMouseDown(e: MouseEvent, pos: Float32Array): void | Promise<void> {}
    onMouseMove(e: MouseEvent, pos: Float32Array): void | Promise<void> {}
    onWheel(e: WheelEvent): void {}
    onContextMenu(e: MouseEvent): void {}
    activate(): void {}
    deactivate(): void {}
}
