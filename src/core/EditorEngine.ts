import { AppEngine } from './AppEngine';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';
import { world, type Entity } from '../ecs';
import type { ToolMode, PlacementState } from '../types';

import { Tool, type IEditorEngine } from './tools/Tool';
import { SelectTool } from './tools/SelectTool';
import { CreateObjTool } from './tools/CreateObjTool';
import { RopeTool } from './tools/RopeTool';
import { JointTool } from './tools/JointTool';

export class EditorEngine extends AppEngine implements IEditorEngine {
    private _tool: ToolMode = 'select';
    placement: PlacementState = null;
    draggedEntity: Entity | null = null;
    dragOffset = new Float32Array([0, 0]);
    
    onSelectEntity?: (ent: Entity | null) => void;
    onRopeStateChange?: () => void;

    private mouseHandlers: { name: string, fn: any }[] = [];

    tools: Partial<Record<ToolMode, Tool>> = {};

    get tool(): ToolMode { return this._tool; }
    set tool(t: ToolMode) {
        if (this._tool === t) return;
        this.tools[this._tool]?.deactivate();
        this._tool = t;
        this.tools[this._tool]?.activate();
    }

    constructor(container: HTMLElement) {
        super(container);
        this.tools['select'] = new SelectTool(this);
        this.tools['create_obj'] = new CreateObjTool(this);
        this.tools['build_line'] = new RopeTool(this);
        this.tools['joint'] = new JointTool(this);
    }

    override async init() {
        await super.init();
        
        const add = (name: string, fn: any, opts?: any) => {
            const handler = fn.bind(this);
            window.addEventListener(name, handler, opts);
            this.mouseHandlers.push({ name, fn: handler });
        };

        add('mousedown', this.onMouseDown);
        add('mousemove', this.onMouseMove);
        add('mouseup', () => (this.draggedEntity = null));
        add('wheel', this.onWheel, { passive: false });
        add('contextmenu', this.onContextMenu);
    }

    override dispose() {
        for (const h of this.mouseHandlers) window.removeEventListener(h.name, h.fn);
        this.tools[this._tool]?.deactivate();
        super.dispose();
    }

    private onMouseDown(e: MouseEvent) {
        if (e.target !== this.canvas) return;
        const pos = getMouseWorld(e, this.canvas, BOUNDS);
        this.tools[this._tool]?.onMouseDown(e, pos);
    }

    private onMouseMove(e: MouseEvent) {
        const pos = getMouseWorld(e, this.canvas, BOUNDS);
        (this as any).mouseWorld = pos;
        
        if (this.renderer && this._tool !== 'build_line' && this._tool !== 'joint') {
            this.renderer.updateGizmo(new Float32Array([1000, 1000]), new Float32Array([0, 0, 0, 0]));
        }
        
        this.tools[this._tool]?.onMouseMove(e, pos);
    }

    private onWheel(e: WheelEvent) {
        this.tools[this._tool]?.onWheel(e);
    }

    private onContextMenu(e: MouseEvent) {
        if (e.target !== this.canvas) return;
        this.tools[this._tool]?.onContextMenu(e);
    }

    override clearScene() {
        super.clearScene();
        this.lastObstacleCount = -1;
        this.onSelectEntity?.(null);
    }
}
