import * as THREE from 'three';
import { AppEngine } from './AppEngine';
import { getMouseWorld } from '../utils';
import { BOUNDS } from '../constants';
import { addObject } from './EntityFactory';
import { world, type Entity } from '../ecs';
import type { ToolMode, PlacementState } from '../types';

export class EditorEngine extends AppEngine {
    tool: ToolMode = 'select';
    placement: PlacementState = null;
    selectedEntityId: string | null = null;
    draggedEntity: Entity | null = null;
    dragOffset = new THREE.Vector2();
    activeRopeId: string | null = null;
    
    private onMouseDownBound: (e: MouseEvent) => void;
    private onMouseMoveBound: (e: MouseEvent) => void;
    private onMouseUpBound: (e: MouseEvent) => void;

    onSelectEntity?: (ent: Entity | null) => void;

    constructor(canvas: HTMLElement) {
        super(canvas);
        this.onMouseDownBound = this.onMouseDown.bind(this);
        this.onMouseMoveBound = this.onMouseMove.bind(this);
        this.onMouseUpBound = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);
    }

    async init() {
        await super.init();
        window.addEventListener('mousedown', this.onMouseDownBound);
        window.addEventListener('mousemove', this.onMouseMoveBound);
        window.addEventListener('mouseup', this.onMouseUpBound);
        window.addEventListener('wheel', this.onWheel);
        // Default floor
        addObject(this.scene, 'static', 'box', new THREE.Vector2(0, -6));
    }

    dispose() {
        window.removeEventListener('mousedown', this.onMouseDownBound);
        window.removeEventListener('mousemove', this.onMouseMoveBound);
        window.removeEventListener('mouseup', this.onMouseUpBound);
        window.removeEventListener('wheel', this.onWheel);
        super.dispose();
    }

    private onMouseDown(e: MouseEvent) {
        if (e.target !== this.renderer.domElement) return;
        const pos = getMouseWorld(e, this.canvas, BOUNDS);

        if (this.tool === 'build_line') {
            const anchor = this.physics.findAnchor(pos);
            if (!this.activeRopeId) {
                const startPos = anchor ? anchor.pos : pos.clone();
                const seg0 = addObject(this.scene, 'dynamic', 'circle', startPos);
                const seg1 = addObject(this.scene, 'dynamic', 'circle', pos.clone());
                seg0.physicsBody!.mass = anchor?.type === 'static' ? 0 : 1;
                seg1.sdfCollider!.parameters[0] = 0.05;
                seg0.sdfCollider!.parameters[0] = 0.05;

                const ropeEnt = world.add({
                    id: Math.random().toString(36).substr(2, 9),
                    name: 'rope',
                    tags: ['rope', 'building'],
                    physicsRope: {
                        headAnchor: { target: anchor?.type === 'particle' ? world.entities[anchor.targetIdx!].id : (anchor ? anchor.pos : seg0.transform!.position.clone()), offset: new THREE.Vector2() },
                        tailAnchor: { target: seg1.id, offset: new THREE.Vector2() },
                        segments: [seg0.id, seg1.id],
                        segmentLength: 0.1,
                        compliance: 0.0001,
                    }
                });
                this.activeRopeId = ropeEnt.id;

                // Add first constraint
                world.add({
                    id: Math.random().toString(36).substr(2, 9),
                    physicsConstraint: {
                        type: anchor?.type === 'particle' ? 0 : (anchor ? 3 : 0),
                        targetA: seg0.id,
                        targetB: anchor?.type === 'particle' ? world.entities[anchor.targetIdx!].id : (anchor ? anchor.pos : seg0.transform!.position.clone()),
                        restValue: 0.05,
                        stiffness: 0,
                        index: undefined as any
                    }
                });
            } else {
                const ropeEnt = world.entities.find(e => e.id === this.activeRopeId);
                if (ropeEnt && ropeEnt.physicsRope) {
                    const lastId = ropeEnt.physicsRope.segments[ropeEnt.physicsRope.segments.length-1];
                    const lastEnt = world.entities.find(e => e.id === lastId);
                    if (anchor && lastEnt) {
                        lastEnt.transform!.position.copy(anchor.pos);
                        lastEnt.physicsBody!.mass = anchor.type === 'static' ? 0 : 1;
                        if (anchor.type === 'particle') {
                             world.add({
                                id: Math.random().toString(36).substr(2, 9),
                                physicsConstraint: { type: 0, targetA: lastId, targetB: world.entities[anchor.targetIdx!].id, restValue: 0.05, stiffness: 0, index: undefined as any }
                             });
                        }
                    }
                    const bIdx = ropeEnt.tags.indexOf('building');
                    if (bIdx !== -1) ropeEnt.tags.splice(bIdx, 1);
                    this.activeRopeId = null;
                }
            }
            return;
        }

        if (this.tool === 'select') {
            const ent = world.entities.find(e => e.transform && e.transform.position.distanceTo(pos) < 0.6);
            
            // Clear flags from previous selection if any
            if (this.selectedEntityId) {
                const prev = world.entities.find(e => e.id === this.selectedEntityId);
                if (prev?.physicsBody) { prev.physicsBody.flags &= ~0x1; this.queuedSync = true; }
            }

            if (ent) {
                this.selectedEntityId = ent.id;
                this.draggedEntity = ent;
                this.dragOffset.copy(ent.transform!.position).sub(pos);
                if (ent.physicsBody) { ent.physicsBody.flags |= 0x1; }
                this.onSelectEntity?.(ent);
                this.queuedSync = true;
            } else {
                this.selectedEntityId = null;
                this.onSelectEntity?.(null);
            }
        } else if (this.tool === 'create_obj' && this.placement) {
            addObject(this.scene, this.placement.type, this.placement.shape, pos);
        }
    }

    private onMouseMove(e: MouseEvent) {
        const pos = getMouseWorld(e, this.canvas, BOUNDS);
        (this as any).mouseWorld = pos;
        if (this.draggedEntity && this.draggedEntity.transform) {
            const pos = getMouseWorld(e, this.canvas, BOUNDS);
            const newPos = pos.add(this.dragOffset);
            this.draggedEntity.transform.position.copy(newPos);
            if (this.draggedEntity.physicsParticle) {
                const idx = this.draggedEntity.physicsParticle.index;
                const b = this.draggedEntity.physicsBody!;
                // Forced teleport in editor
                this.physics.setParticle(idx, newPos, newPos, b.mass, b.friction, this.draggedEntity.sdfCollider?.parameters[0] || 0.5, b.collisionMask, b.appearance, b.flags);
                // Ensure it gets synced to GPU
                this.physics.queuedSync = true;
            }
        }
    }

    private onMouseUp() {
        this.draggedEntity = null;
    }

    private onWheel(e: WheelEvent) {
        if (this.activeRopeId) {
            const ropeEnt = world.entities.find(e => e.id === this.activeRopeId);
            if (ropeEnt && ropeEnt.physicsRope) {
                ropeEnt.physicsRope.segmentLength = Math.max(0.02, ropeEnt.physicsRope.segmentLength + (e.deltaY > 0 ? 0.01 : -0.01));
            }
        }
    }
}
