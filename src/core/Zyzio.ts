import { vec2, type Vec2 } from 'wgpu-matrix';
import { WebPhysics } from '../webPhysics';
import { PHYSICS_CONFIG } from '../constants';
import { world, type Entity } from '../ecs';
import { addObject } from './EntityFactory';

interface Leg {
    foot: Entity;
    knee: Entity;
    offset: Vec2;
    group: number;
    isSwinging: boolean;
    swingTimer: number;
    startPos: Vec2;
    targetPos: Vec2;
}

export class Zyzio {
    physics: WebPhysics;
    body: Entity;
    legs: Leg[] = [];
    
    // IK & Animation Parameters
    stepRadius = 1.2;
    stepHeight = 0.8;
    stepSpeed = 0.15;

    // Wall-Walking State
    upDir = vec2.create(0, 1);
    forwardDir = vec2.create(1, 0);
    targetUpDir = vec2.create(0, 1);
    raycastPending = false;
    grounded = false;
    isJumping = false;
    jumpCooldown = 0;
    groundDistance = 0;

    constructor(physics: WebPhysics, spawnPos: Vec2) {
        this.physics = physics;
        
        // Core Body
        this.body = addObject(physics, 'dynamic', 'circle', spawnPos as Float32Array, 0.7, 3);
        this.body.physicsBody!.mass = 1.0;
        this.body.physicsBody!.friction = 0.5;
        this.body.physicsBody!.collisionMask = 0;

        const configs = [
            { o: vec2.create(1.5, -1.0), group: 0 },
            { o: vec2.create(0.0, -1.0), group: 1 },
            { o: vec2.create(-1.5, -1.0), group: 0 },
            { o: vec2.create(1.2, -1.0), group: 1 },
            { o: vec2.create(-0.2, -1.0), group: 0 },
            { o: vec2.create(-1.2, -1.0), group: 1 },
        ];

        for (const c of configs) {
            const footPos = vec2.add(spawnPos, c.o);
            const foot = addObject(physics, 'dynamic', 'circle', footPos as Float32Array, 0.1, 3);
            foot.physicsBody!.mass = 1.0;
            foot.physicsBody!.friction = 1.0;
            foot.physicsBody!.collisionMask = 0;

            // Knees roughly halfway between body and foot, raised up
            const kneePos = vec2.addScaled(spawnPos, c.o, 0.5);
            kneePos[1] += 0.5;
            const knee = addObject(physics, 'dynamic', 'circle', kneePos as Float32Array, 0.05, 3);
            knee.physicsBody!.mass = 0.1;
            knee.physicsBody!.collisionMask = 0;

            const createConstraint = (a: Entity, b: Entity, rest: number, comp: number) => {
                world.add({
                    id: Math.random().toString(36).substring(2, 9), 
                    name: 'zyzio_c', tags: ['constraint'],
                    physicsConstraint: { type: 0, targetA: a, targetB: b, restValue: rest, compliance: comp, index: -1 }
                });
            };

            createConstraint(this.body, knee, 1.2, 0.0001);
            createConstraint(knee, foot, 1.2, 0.0001);
            
            // Initial Angle Constraint for biomechanical stability
            const v0 = vec2.sub(spawnPos, kneePos);
            const v2 = vec2.sub(footPos, kneePos);
            const restAngle = Math.atan2(v0[0] * v2[1] - v0[1] * v2[0], v0[0] * v2[0] + v0[1] * v2[1]);

            world.add({
                id: Math.random().toString(36).substring(2, 9), 
                name: 'zyzio_angle', tags: ['constraint'],
                physicsConstraint: { 
                    type: 1, targetA: this.body, targetB: knee, targetC: foot, 
                    restValue: restAngle, compliance: 0.002, index: -1 
                }
            });

            this.legs.push({
                foot, knee, offset: c.o, group: c.group,
                isSwinging: false, swingTimer: 0,
                startPos: vec2.create(), targetPos: vec2.create()
            });
        }
    }

    update(keys: { w: boolean, a: boolean, s: boolean, d: boolean, space: boolean }) {
        const dt = PHYSICS_CONFIG.DT;
        const bPos = this.body.transform!.position as Vec2;
        const moveInput = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
        
        if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
        if (this.isJumping && this.jumpCooldown <= 0 && this.grounded) {
            this.isJumping = false;
        }

        // 1. Raycast Environment (Surface Normal Detection)
        if (!this.raycastPending) {
            this.raycastPending = true;

            let dx = -this.upDir[0];
            let dy = -this.upDir[1];

            if (moveInput !== 0) {
                dx += this.forwardDir[0] * moveInput * 0.8;
                dy += this.forwardDir[1] * moveInput * 0.8;
            }
            const len = Math.hypot(dx, dy);
            if (len > 0.0001) { dx /= len; dy /= len; }

            // przygotuj oba raycasty
            const ray1 = this.physics.raycast(
                bPos as Float32Array,
                vec2.create(dx, dy) as Float32Array,
                3.0,
                0xFF
            );

            const down = vec2.create(0, -1) as Float32Array;
            const ray2 = this.physics.raycast(
                bPos as Float32Array,
                down,
                5.0,
                0xFF
            );

            Promise.all([ray1, ray2]).then(([res, res2]) => {

                // --- pierwszy raycast (kierunek ruchu / upDir) ---
                if (res.hitType !== 0 && res.distance < 2.5) {
                    vec2.copy(res.hitNormal as Vec2, this.targetUpDir);
                    this.grounded = true;
                } else {
                    this.grounded = false;
                    vec2.set(0, 1, this.targetUpDir);
                }

                // --- drugi raycast (dystans do gruntu) ---
                if (res2.hitType !== 0) {
                    this.groundDistance = res2.distance;
                } else {
                    this.groundDistance = Infinity;
                }

            }).finally(() => {
                this.raycastPending = false;
            });
        }

        // Smoothly interpolate orientation vectors
        vec2.lerp(this.upDir, this.targetUpDir, 0.15, this.upDir);
        vec2.normalize(this.upDir, this.upDir);
        
        // Rotate forward direction 90 deg relative to local up
        vec2.set(this.upDir[1], -this.upDir[0], this.forwardDir);

        // 2. Physics Forces (Anti-Gravity & Locomotion)
        if (this.grounded && !this.isJumping) {
            const agX = -this.upDir[0] * 15.0 * dt;
            const agY = 9.81 * dt - this.upDir[1] * 15.0 * dt;
            
            this.physics.applyImpulse(this.body.physicsParticle!.index, agX, agY);
            for (const leg of this.legs) {
                this.physics.applyImpulse(leg.foot.physicsParticle!.index, agX, agY);
                this.physics.applyImpulse(leg.knee.physicsParticle!.index, agX, agY);
            }
        }

        if (moveInput !== 0 && this.grounded && !this.isJumping) {
            const moveForce = 0.5;
            this.physics.applyImpulse(this.body.physicsParticle!.index, 
                this.forwardDir[0] * moveInput * moveForce, 
                this.forwardDir[1] * moveInput * moveForce);
        }

        if (keys.space && this.grounded && this.jumpCooldown <= 0) {
            this.isJumping = true;
            this.jumpCooldown = 0.5;
            this.grounded = false;
            
            const jumpForce = 15.0;
            this.physics.applyImpulse(this.body.physicsParticle!.index, this.upDir[0] * jumpForce, this.upDir[1] * jumpForce);
            
            for (const leg of this.legs) {
                leg.foot.physicsBody!.mass = 0.5;
                leg.foot.physicsBody!.isDirty = true;
                leg.isSwinging = false;
            }
        }

        // 3. Foot Planting State Management
        if (!this.grounded || this.isJumping) {
            for (const leg of this.legs) {
                if (leg.foot.physicsBody!.mass !== 0.5) {
                    leg.foot.physicsBody!.mass = 0.5;
                    leg.foot.physicsBody!.isDirty = true;
                    leg.isSwinging = false;
                }
            }
        } else {
            for (const leg of this.legs) {
                if (!leg.isSwinging && leg.foot.physicsBody!.mass !== 1.0) {
                    leg.foot.physicsBody!.mass = 1.0;
                    leg.foot.physicsBody!.isDirty = true;
                }
            }
        }

        // 4. IK Leg Stepping
        let swingingGroup = -1;
        for (const leg of this.legs) if (leg.isSwinging) { swingingGroup = leg.group; break; }

        const moveOffset = moveInput * 1.5;

        for (const leg of this.legs) {
            if (this.isJumping || !this.grounded) continue;

            const footPos = leg.foot.transform!.position as Vec2;

            if (leg.isSwinging) {
                leg.swingTimer += dt;
                const t = Math.min(leg.swingTimer / this.stepSpeed, 1.0);
                
                const arc = Math.sin(t * Math.PI) * this.stepHeight;
                const x = leg.startPos[0] + (leg.targetPos[0] - leg.startPos[0]) * t + this.upDir[0] * arc;
                const y = leg.startPos[1] + (leg.targetPos[1] - leg.startPos[1]) * t + this.upDir[1] * arc;
                
                vec2.set(x, y, footPos);
                this.physics.updateParticlePos(leg.foot.physicsParticle!.index, footPos as Float32Array);

                if (t >= 1.0) {
                    leg.isSwinging = false;
                    leg.foot.physicsBody!.mass = 1.0;
                    leg.foot.physicsBody!.isDirty = true;
                }
            } else {
                // Calculate ideal position relative to local up/forward dirs
                const idealPos = vec2.addScaled(bPos, this.forwardDir, leg.offset[0] + moveOffset);
                vec2.addScaled(idealPos, this.upDir, leg.offset[1], idealPos);
                
                const distSq = vec2.distSq(footPos, idealPos);
                
                if (distSq > this.stepRadius * this.stepRadius && (swingingGroup === -1 || swingingGroup === leg.group)) {
                    leg.isSwinging = true;
                    leg.swingTimer = 0;
                    vec2.copy(footPos, leg.startPos);
                    vec2.copy(idealPos, leg.targetPos);
                    
                    leg.foot.physicsBody!.mass = 0.0;
                    leg.foot.physicsBody!.isDirty = true;
                    swingingGroup = leg.group;
                }
            }
        }
    }

    dispose() {
        world.remove(this.body);
        for (const leg of this.legs) {
            world.remove(leg.foot);
            world.remove(leg.knee);
            const c = world.entities.filter(e => e.physicsConstraint && (e.physicsConstraint.targetA === leg.foot || e.physicsConstraint.targetB === leg.foot || e.physicsConstraint.targetC === leg.foot));
            c.forEach(ent => world.remove(ent));
        }
    }
}
