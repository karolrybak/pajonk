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

    constructor(container: HTMLElement) {
        super(container);
    }

    override async init() {
        await super.init();
        
        window.addEventListener('mousedown', (e) => this.onMouseDown(e));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', () => (this.draggedEntity = null));
        window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        window.addEventListener('contextmenu', (e) => {
             if (this.tool === 'build_line' || this.activeRope) e.preventDefault();
             if (this.activeRope) this.cancelRope();
        });
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

    private onMouseDown(e: MouseEvent) {
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
            
            const anchor = this.physics.findAnchor(pos);
            const pinPos = anchor ? anchor.pos : pos.slice();

            if (!this.activeRope) {
                const seg0 = addObject(this.physics, 'dynamic', 'circle', pinPos, 0.05, 6);
                const seg1 = addObject(this.physics, 'dynamic', 'circle', pinPos.slice(), 0.05, 6);
                
                if (anchor?.type === 'static') seg0.physicsBody!.mass = 0;

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
                RopeSystem.createLink(seg0, targetB, 0.05, 0);
                RopeSystem.createLink(seg0, seg1, 0.1, 0.0001);
                this.onRopeStateChange?.();
            } else {
                const lastSeg = this.activeRope.physicsRope!.segments[this.activeRope.physicsRope!.segments.length - 1]!;
                if (anchor) {
                    lastSeg.transform!.position.set(anchor.pos);
                    const targetB = anchor.targetIdx !== undefined ? world.entities.find(ent => ent.physicsParticle?.index === anchor.targetIdx)! : anchor.pos;
                    RopeSystem.createLink(lastSeg, targetB, 0.05, 0);
                    if (anchor.type === 'static') lastSeg.physicsBody!.mass = 0;
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

    private onMouseMove(e: MouseEvent) {
        const pos = getMouseWorld(e, this.canvas, BOUNDS);
        (this as any).mouseWorld = pos;
        
        if (this.renderer) {
            if (this.tool === 'build_line') {
                const anchor = this.physics.findAnchor(pos);
                const color = anchor ? (anchor.type === 'static' ? new Float32Array([0.2, 0.4, 1.0, 0.8]) : new Float32Array([0.2, 1.0, 0.4, 0.8])) : new Float32Array([0.8, 0.8, 0.8, 0.5]);
                const gizmoPos = anchor ? anchor.pos : pos;
                this.renderer.updateGizmo(gizmoPos, color);
            } else {
                this.renderer.updateGizmo(new Float32Array([1000, 1000]), new Float32Array([0, 0, 0, 0]));
            }
        }

        if (this.draggedEntity && this.draggedEntity.transform) {
            this.draggedEntity.transform.position.set(vec2.add(pos, this.dragOffset) as Float32Array);
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