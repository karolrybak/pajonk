import { vec2 } from 'wgpu-matrix';
import { world, type Entity } from '../../ecs';
import { addObject } from '../EntityFactory';
import { RopeSystem } from '../RopeSystem';
import { Tool } from './Tool';

export class RopeTool extends Tool {
    ropeMode: 'auto' | 'manual' = 'auto';
    activeRope: Entity | null = null;
    private activeAnchorQuery = false;

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
        this.engine.onRopeStateChange?.();
    }

    override deactivate() {
        this.cancelRope();
    }

    override async onMouseDown(e: MouseEvent, pos: Float32Array) {
        if (e.button === 1) {
            e.preventDefault();
            this.ropeMode = this.ropeMode === 'auto' ? 'manual' : 'auto';
            this.engine.onRopeStateChange?.();
            return;
        }
        if (e.button === 2) return;
        
        const ignore = this.activeRope ? this.activeRope.physicsRope!.segments.map(s => s.physicsParticle?.index ?? -1) : [];
        const anchor = await this.engine.physics.findAnchor(pos, ignore);
        if (this.engine.tool !== 'build_line') return;
        
        const pinPos = anchor ? anchor.pos : pos.slice();

        if (!this.activeRope) {
            const seg0 = addObject(this.engine.physics, 'dynamic', 'circle', pinPos, 0.05, 6);
            const seg1 = addObject(this.engine.physics, 'dynamic', 'circle', vec2.add(pinPos, [0.01, 0.01]) as Float32Array, 0.05, 6);
            
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
            this.engine.onRopeStateChange?.();
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
            this.engine.onRopeStateChange?.();
        }
    }

    override async onMouseMove(e: MouseEvent, pos: Float32Array) {
        if (this.activeAnchorQuery) return;
        this.activeAnchorQuery = true;
        const ignore = this.activeRope ? this.activeRope.physicsRope!.segments.map(s => s.physicsParticle?.index ?? -1) : [];
        const anchor = await this.engine.physics.findAnchor(pos, ignore);
        this.activeAnchorQuery = false;
        if (this.engine.tool !== 'build_line') return;

        const color = anchor ? (anchor.type === 'static' ? new Float32Array([0.2, 0.4, 1.0, 0.8]) : new Float32Array([0.2, 1.0, 0.4, 0.8])) : new Float32Array([0.8, 0.8, 0.8, 0.5]);
        const gizmoPos = anchor ? anchor.pos : pos;
        this.engine.renderer.updateGizmo(gizmoPos, color);
    }

    override onWheel(e: WheelEvent) {
        if (this.activeRope) {
            if (this.ropeMode === 'auto') {
                this.ropeMode = 'manual';
                this.engine.onRopeStateChange?.();
            }
            e.preventDefault();
            const rope = this.activeRope.physicsRope!;
            if (e.deltaY < 0) {
                const last = rope.segments[rope.segments.length-1]!;
                if (last.transform) {
                    const nextPos = vec2.add(last.transform.position, new Float32Array([0, 0.1])) as Float32Array;
                    const newSeg = addObject(this.engine.physics, 'dynamic', 'circle', nextPos, 0.05, 6);
                    newSeg.physicsBody!.mass = 0.1;
                    newSeg.physicsBody!.collisionMask = 0; // Prevent violent collisions inside rope
                    RopeSystem.createLink(last, newSeg, rope.segmentLength, rope.compliance);
                    rope.segments.push(newSeg);
                    this.engine.onRopeStateChange?.();
                }
            } else if (rope.segments.length > 2) {
                const removed = rope.segments.pop();
                if (removed) {
                    world.remove(removed);
                    const c = world.entities.find(ent => ent.physicsConstraint && (ent.physicsConstraint.targetA === removed || ent.physicsConstraint.targetB === removed));
                    if (c) world.remove(c);
                    this.engine.onRopeStateChange?.();
                }
            }
        }
    }

    override onContextMenu(e: MouseEvent) {
        if (this.activeRope) {
            e.preventDefault();
            this.cancelRope();
        }
    }
}
