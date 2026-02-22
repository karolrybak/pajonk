import { vec2 } from 'wgpu-matrix';
import { world, type Entity } from '../../ecs';
import { addObject } from '../EntityFactory';
import { Tool } from './Tool';

export class JointTool extends Tool {
    activeJointPoints: { ent?: Entity, pos?: Float32Array, temp: boolean }[] = [];
    private activeAnchorQuery = false;

    cancelJoint() {
        for (const p of this.activeJointPoints) {
            if (p.temp && p.ent) {
                world.remove(p.ent);
            }
        }
        this.activeJointPoints = [];
    }

    override deactivate() {
        this.cancelJoint();
    }

    override async onMouseDown(e: MouseEvent, pos: Float32Array) {
        const placement = this.engine.placement;
        if (!placement || placement.type !== 'joint' || !placement.subtype) return;
        if (e.button === 2) return;
        
        const physics = this.engine.physics;
        const ignore = this.activeJointPoints.map(p => p.ent?.physicsParticle?.index ?? -1);
        const anchor = await physics.findAnchor(pos, ignore);
        
        if (this.engine.tool !== 'joint') return;

        const subtype = placement.subtype;
        const reqPoints = (subtype === 'angular' || subtype === 'area') ? 3 : 2;
        
        let pEnt: Entity | undefined = undefined;
        let pPos: Float32Array | undefined = undefined;
        let temp = false;

        if (subtype === 'anchor' && this.activeJointPoints.length === 1) {
            pPos = anchor ? anchor.pos : pos;
        } else {
            if (anchor && anchor.type === 'particle' && anchor.targetIdx !== undefined) {
                pEnt = world.with('physicsParticle').entities.find(ent => ent.physicsParticle?.index === anchor.targetIdx);
                
                if (!pEnt) {
                    pEnt = addObject(physics, 'dynamic', 'circle', anchor.pos, 0.05, 6);
                    pEnt.physicsBody!.mass = 0.1;
                    pEnt.editor_ui = { visible: true };
                    temp = true;
                }
            } else {
                const spawnPos = anchor ? anchor.pos : pos;
                pEnt = addObject(physics, 'dynamic', 'circle', spawnPos, 0.05, 6);
                pEnt.physicsBody!.mass = 0.1;
                pEnt.editor_ui = { visible: true };
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
            
            const p1 = this.activeJointPoints[0]!;
            const p2 = this.activeJointPoints[1]!;
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
    }

    override async onMouseMove(e: MouseEvent, pos: Float32Array) {
        if (this.activeAnchorQuery) return;
        this.activeAnchorQuery = true;
        
        const physics = this.engine.physics;
        const ignore = this.activeJointPoints.map(p => p.ent?.physicsParticle?.index ?? -1);
        const anchor = await physics.findAnchor(pos, ignore);
        
        this.activeAnchorQuery = false;
        if (this.engine.tool !== 'joint') return;

        const color = (anchor && anchor.type === 'particle') ? new Float32Array([0.2, 1.0, 0.4, 0.8]) : new Float32Array([1.0, 0.6, 0.2, 0.8]);
        const gizmoPos = anchor ? anchor.pos : pos;
        this.engine.renderer.updateGizmo(gizmoPos, color);
    }

    override onContextMenu(e: MouseEvent) {
        if (this.activeJointPoints.length > 0) {
            e.preventDefault();
            this.cancelJoint();
        }
    }
}
