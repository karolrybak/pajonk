import { vec2 } from 'wgpu-matrix';
import { AppEngine } from './AppEngine';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';
import { addObject } from './EntityFactory';
import { world, type Entity } from '../ecs';
import { type ToolMode, type PlacementState } from '../types';
import { RopeSystem } from './RopeSystem';

export class EditorEngine extends AppEngine {
    tool: ToolMode = 'select';
    placement: PlacementState = null;
    draggedEntity: Entity | null = null;
    dragOffset = new Float32Array([0, 0]);
    
    ropeMode: 'auto' | 'manual' = 'auto';
    activeRope: Entity | null = null;
    onSelectEntity?: (ent: Entity | null) => void;
    onRopeStateChange?: () => void;

    private mouseHandlers: { name: string, fn: any }[] = [];
    private activeAnchorQuery = false;

    constructor(container: HTMLElement) {
        super(container);
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
        add('contextmenu', (e: MouseEvent) => {
             if (this.tool === 'build_line' || this.activeRope) e.preventDefault();
             if (this.activeRope) this.cancelRope();
        });
    }

    override dispose() {
        for (const h of this.mouseHandlers) window.removeEventListener(h.name, h.fn);
        super.dispose();
    }

    cancelRope() {
        if (!this.activeRope) return;
        const rope = this.activeRope.physicsRope!;
        for (const seg of rope.segments) world.remove(seg);
        
        const constraints = world.entities.filter(e => 
            e.physicsConstraint && 
            (rope.segments.includes(e.physicsConstraint.targetA) || 
             (!(e.physicsConstraint.targetB instanceof Float32Array) && rope.segments.includes(e.physicsConstraint.targetB as any)))
        );
        for (const c of constraints) world.remove(c);
        
        world.remove(this.activeRope);
        this.activeRope = null;
        this.onRopeStateChange?.();
    }

    private async onMouseDown(e: MouseEvent) {
        if (e.target !== this.canvas) return;
        const pos = getMouseWorld(e, this.canvas, BOUNDS);
        
        if (e.button === 1) {
             e.preventDefault();
             this.ropeMode = this.ropeMode === 'auto' ? 'manual' : 'auto';
             this.onRopeStateChange?.();
             return;
        }

        if (this.tool === 'build_line') {
            if (e.button === 2) return;
            
            const ignore = this.activeRope ? this.activeRope.physicsRope!.segments.map(s => s.physicsParticle?.index ?? -1) : [];
            const anchor = await this.physics.findAnchor(pos, ignore);
            if (this.tool !== 'build_line') return;
            
            const pinPos = anchor ? anchor.pos : pos.slice();

            if (!this.activeRope) {
                const seg0 = addObject(this.physics, 'dynamic', 'circle', pinPos, 0.05, 6);
                const seg1 = addObject(this.physics, 'dynamic', 'circle', vec2.add(pinPos, [0.01, 0.01]) as Float32Array, 0.05, 6);
                
                seg0.physicsBody!.mass = 0.1;
                seg1.physicsBody!.mass = 0.1;
                seg0.physicsBody!.collisionMask = 0;
                seg1.physicsBody!.collisionMask = 0;
                if (anchor?.type === 'static') {
                    seg0.physicsBody!.mass = 0;
                    seg0.physicsBody!.isDirty = true;
                }

                this.activeRope = world.add({
                    id: Math.random().toString(36).substr(2, 9), name: 'rope', tags: ['rope', 'building'],
                    editor_ui: { visible: true },
                    physicsRope: {
                        headAnchor: { target: anchor?.targetIdx !== undefined ? world.entities.find(ent => ent.physicsParticle?.index === anchor.targetIdx)! : pinPos, offset: new Float32Array([0,0]) },
                        tailAnchor: { target: seg1, offset: new Float32Array([0,0]) },
                        segments: [seg0, seg1], segmentLength: 0.1, compliance: 0.0001,
                    }
                });

                const targetB = anchor?.targetIdx !== undefined ? world.entities.find(ent => ent.physicsParticle?.index === anchor.targetIdx)! : pinPos;
                const startRest = anchor?.radius !== undefined ? (0.05 + anchor.radius) : 0.05;
                RopeSystem.createLink(seg0, targetB, startRest, 0);
                RopeSystem.createLink(seg0, seg1, 0.1, 0);
                this.onRopeStateChange?.();
            } else {
                const lastSeg = this.activeRope.physicsRope!.segments[this.activeRope.physicsRope!.segments.length - 1]!;
                if (anchor) {
                    lastSeg.transform!.position.set(anchor.pos);
                    const targetB = anchor.targetIdx !== undefined ? world.entities.find(ent => ent.physicsParticle?.index === anchor.targetIdx)! : anchor.pos;
                    const endRest = anchor.radius !== undefined ? (0.05 + anchor.radius) : 0.05;
                    RopeSystem.createLink(lastSeg, targetB, endRest, 0);
                    if (anchor.type === 'static') {
                        lastSeg.physicsBody!.mass = 0;
                        lastSeg.physicsBody!.isDirty = true;
                    }
                }
                this.activeRope.tags = this.activeRope.tags.filter(t => t !== 'building');
                this.activeRope = null;
                this.onRopeStateChange?.();
            }
            return;
        }

        if (this.tool === 'select' && e.button === 0) {
            const ent = world.entities.find(e => e.transform && vec2.distance(e.transform.position, pos) < 0.6);
            if (ent) {
                this.selectedEntity = ent;
                this.draggedEntity = ent;
                vec2.sub(ent.transform!.position, pos, this.dragOffset);
                this.onSelectEntity?.(ent);
            } else {
                this.selectedEntity = null; 
                this.onSelectEntity?.(null);
            }
        } else if (this.tool === 'create_obj' && this.placement) {
            addObject(this.physics, this.placement.type as 'static' | 'dynamic', this.placement.shape, pos);
        }
    }

    private async onMouseMove(e: MouseEvent) {
        const pos = getMouseWorld(e, this.canvas, BOUNDS);
        (this as any).mouseWorld = pos;
        
        if (this.renderer) {
            if (this.tool === 'build_line') {
                if (this.activeAnchorQuery) return;
                this.activeAnchorQuery = true;
                const ignore = this.activeRope ? this.activeRope.physicsRope!.segments.map(s => s.physicsParticle?.index ?? -1) : [];
                const anchor = await this.physics.findAnchor(pos, ignore);
                this.activeAnchorQuery = false;
                if (this.tool !== 'build_line') return;

                const color = anchor ? (anchor.type === 'static' ? new Float32Array([0.2, 0.4, 1.0, 0.8]) : new Float32Array([0.2, 1.0, 0.4, 0.8])) : new Float32Array([0.8, 0.8, 0.8, 0.5]);
                const gizmoPos = anchor ? anchor.pos : pos;
                this.renderer.updateGizmo(gizmoPos, color);
            } else {
                this.renderer.updateGizmo(new Float32Array([1000, 1000]), new Float32Array([0, 0, 0, 0]));
            }
        }

        if (this.draggedEntity && this.draggedEntity.transform) {
            const newPos = vec2.add(pos, this.dragOffset) as Float32Array;
            this.draggedEntity.transform.position.set(newPos);
            
            const parentRope = world.with('physicsRope').entities.find(r => 
                r.physicsRope!.segments.includes(this.draggedEntity!)
            );
            if (parentRope && !parentRope.tags.includes('building')) {
                parentRope.tags.push('building');
            }
        }
    }

    private onWheel(e: WheelEvent) {
        if (this.activeRope) {
            if (this.ropeMode === 'auto') {
                this.ropeMode = 'manual';
                this.onRopeStateChange?.();
            }
            e.preventDefault();
            const rope = this.activeRope.physicsRope!;
            if (e.deltaY < 0) {
                const last = rope.segments[rope.segments.length-1]!;
                if (last.transform) {
                    const nextPos = vec2.add(last.transform.position, new Float32Array([0, 0.1])) as Float32Array;
                    const newSeg = addObject(this.physics, 'dynamic', 'circle', nextPos, 0.05, 6);
                    newSeg.physicsBody!.mass = 0.1;
                    newSeg.physicsBody!.collisionMask = 0; // Prevent violent collisions inside rope
                    RopeSystem.createLink(last, newSeg, rope.segmentLength, rope.compliance);
                    rope.segments.push(newSeg);
                    this.onRopeStateChange?.();
                }
            } else if (rope.segments.length > 2) {
                const removed = rope.segments.pop();
                if (removed) {
                    world.remove(removed);
                    const c = world.entities.find(e => e.physicsConstraint && (e.physicsConstraint.targetA === removed || e.physicsConstraint.targetB === removed));
                    if (c) world.remove(c);
                    this.onRopeStateChange?.();
                }
            }
        }
    }

    override clearScene() {
        super.clearScene();
        this.lastObstacleCount = -1;
    }
}
