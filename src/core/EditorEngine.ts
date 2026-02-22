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
    activeJointPoints: { ent?: Entity, pos?: Float32Array, temp: boolean }[] = [];
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
             
             if (this.tool === 'joint' || this.activeJointPoints.length > 0) e.preventDefault();
             if (this.activeJointPoints.length > 0) this.cancelJoint();
        });
    }

    override dispose() {
        for (const h of this.mouseHandlers) window.removeEventListener(h.name, h.fn);
        super.dispose();
    }

    cancelJoint() {
        for (const p of this.activeJointPoints) {
            if (p.temp && p.ent) {
                world.remove(p.ent);
            }
        }
        this.activeJointPoints = [];
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

        if (this.tool === 'joint' && this.placement?.subtype) {
            if (e.button === 2) return;
            
            const ignore = this.activeJointPoints.map(p => p.ent?.physicsParticle?.index ?? -1);
            const anchor = await this.physics.findAnchor(pos, ignore);
            if (this.tool !== 'joint') return;

            const subtype = this.placement.subtype;
            const reqPoints = (subtype === 'angular' || subtype === 'area') ? 3 : 2;
            
            let pEnt: Entity | undefined = undefined;
            let pPos: Float32Array | undefined = undefined;
            let temp = false;

            if (subtype === 'anchor' && this.activeJointPoints.length === 1) {
                pPos = anchor ? anchor.pos : pos;
            } else {
                if (anchor && anchor.type === 'particle' && anchor.targetIdx !== undefined) {
                    pEnt = world.entities.find(ent => ent.physicsParticle?.index === anchor.targetIdx);
                    if (!pEnt) {
                        pEnt = addObject(this.physics, 'dynamic', 'circle', anchor.pos, 0.05, 6);
                        pEnt.physicsBody!.mass = 0.1;
                        temp = true;
                    }
                } else {
                    const spawnPos = anchor ? anchor.pos : pos;
                    pEnt = addObject(this.physics, 'dynamic', 'circle', spawnPos, 0.05, 6);
                    pEnt.physicsBody!.mass = 0.1;
                    if (anchor && anchor.type === 'static') {
                        pEnt.physicsBody!.mass = 0.0;
                        pEnt.physicsBody!.isDirty = true;
                    }
                    temp = true;
                }
            }
            
            this.activeJointPoints.push({ ent: pEnt, pos: pPos, temp });

            if (this.activeJointPoints.length === reqPoints) {
                let cType = 0;
                let restValue = 0;
                
                const p1 = this.activeJointPoints[0];
                const p2 = this.activeJointPoints[1];
                const p3 = this.activeJointPoints[2];

                if (subtype === 'anchor') cType = 3;
                else if (subtype === 'distance') cType = 0;
                else if (subtype === 'inequality') cType = 4;
                else if (subtype === 'angular') cType = 1;
                else if (subtype === 'area') cType = 2;

                const tA = p1.ent!;
                let tB: Entity | Float32Array = p2.ent || p2.pos!;
                let tC: Entity | undefined = p3?.ent;

                if (subtype === 'anchor') {
                    tB = p2.pos!;
                    restValue = 0;
                } else if (subtype === 'distance' || subtype === 'inequality') {
                    restValue = vec2.distance(tA.transform!.position, (tB as Entity).transform!.position);
                } else if (subtype === 'angular') {
                    const v0 = vec2.sub(tA.transform!.position, (tB as Entity).transform!.position);
                    const v2 = vec2.sub(tC!.transform!.position, (tB as Entity).transform!.position);
                    restValue = Math.atan2(v0[0]*v2[1] - v0[1]*v2[0], v0[0]*v2[0] + v0[1]*v2[1]);
                } else if (subtype === 'area') {
                    const p0 = tA.transform!.position;
                    const p1pos = (tB as Entity).transform!.position;
                    const p2pos = tC!.transform!.position;
                    restValue = 0.5 * ((p1pos[0] - p0[0]) * (p2pos[1] - p0[1]) - (p1pos[1] - p0[1]) * (p2pos[0] - p0[0]));
                }

                world.add({
                    id: Math.random().toString(36).substr(2, 9),
                    name: `joint_${subtype}`,
                    tags: ['constraint'],
                    editor_ui: { visible: true },
                    physicsConstraint: {
                        type: cType,
                        targetA: tA,
                        targetB: tB,
                        targetC: tC,
                        restValue: restValue,
                        compliance: 0.0001,
                        index: -1
                    }
                });

                for (const p of this.activeJointPoints) p.temp = false;
                this.activeJointPoints = [];
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
            if (this.tool === 'build_line' || this.tool === 'joint') {
                if (this.activeAnchorQuery) return;
                this.activeAnchorQuery = true;
                let ignore: number[] = [];
                if (this.tool === 'build_line') {
                    ignore = this.activeRope ? this.activeRope.physicsRope!.segments.map(s => s.physicsParticle?.index ?? -1) : [];
                } else if (this.tool === 'joint') {
                    ignore = this.activeJointPoints.map(p => p.ent?.physicsParticle?.index ?? -1);
                }
                const anchor = await this.physics.findAnchor(pos, ignore);
                this.activeAnchorQuery = false;
                if (this.tool !== 'build_line' && this.tool !== 'joint') return;

                let color = new Float32Array([0.8, 0.8, 0.8, 0.5]);
                if (this.tool === 'build_line') {
                    color = anchor ? (anchor.type === 'static' ? new Float32Array([0.2, 0.4, 1.0, 0.8]) : new Float32Array([0.2, 1.0, 0.4, 0.8])) : new Float32Array([0.8, 0.8, 0.8, 0.5]);
                } else {
                    color = (anchor && anchor.type === 'particle') ? new Float32Array([0.2, 1.0, 0.4, 0.8]) : new Float32Array([1.0, 0.6, 0.2, 0.8]);
                }
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
        this.onSelectEntity?.(null);
    }
}
