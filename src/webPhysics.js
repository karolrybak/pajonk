import * as THREE from 'three';

export class WebPhysics {
    constructor(scene, bounds) {
        this.scene = scene;
        this.bounds = bounds;
        this.gravity = -18.0;
        this.webs = [];
        this.balls = [];
        this.ropeSegLen = 0.15;
        this.collisionMargin = 0.01;
        
        this.ballMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    }

    sdCircle(p, r) { return p.length() - r; }
    sdBox(p, b) {
        const d = new THREE.Vector2(Math.abs(p.x) - b.x, Math.abs(p.y) - b.y);
        const outside = new THREE.Vector2(Math.max(d.x, 0), Math.max(d.y, 0)).length();
        const inside = Math.min(Math.max(d.x, d.y), 0);
        return outside + inside;
    }

    worldSDF(p) {
        let d = -this.sdBox(p, { x: this.bounds.width / 2, y: this.bounds.height / 2 });
        d = Math.min(d, this.sdCircle(new THREE.Vector2(p.x - 4, p.y - 2), 1.5));
        d = Math.min(d, this.sdCircle(new THREE.Vector2(p.x + 5, p.y + 1), 1.2));
        d = Math.min(d, this.sdBox(new THREE.Vector2(p.x, p.y + 4), { x: 3, y: 0.5 }));
        return d;
    }

    getNormal(p) {
        const eps = 0.005;
        const dx = this.worldSDF(new THREE.Vector2(p.x + eps, p.y)) - this.worldSDF(new THREE.Vector2(p.x - eps, p.y));
        const dy = this.worldSDF(new THREE.Vector2(p.x, p.y + eps)) - this.worldSDF(new THREE.Vector2(p.x, p.y - eps));
        return new THREE.Vector2(dx, dy).normalize();
    }

    createWeb(startPos, isFixedToWall, attachment = null) {
        const points = [
            { pos: startPos.clone(), oldPos: startPos.clone(), fixed: isFixedToWall, attachment },
            { pos: startPos.clone(), oldPos: startPos.clone(), fixed: false, attachment: null }
        ];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(1500 * 3), 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
        line.frustumCulled = false;
        this.scene.add(line);
        const web = { points, length: 0.5, line, isBeingBuilt: true };
        this.webs.push(web);
        return web;
    }

    spawnBall(pos) {
        const radius = 0.4 + Math.random() * 0.4;
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), this.ballMat);
        mesh.position.set(pos.x, pos.y, -0.5);
        this.scene.add(mesh);

        this.balls.push({
            pos: pos.clone(),
            oldPos: pos.clone().add(new THREE.Vector2((Math.random()-0.5)*0.1, 0)),
            radius,
            mesh
        });
    }

    update(dt, mousePos, activeRope) {
        // 1. Integration
        for (let web of this.webs) {
            this.integrateWeb(web, mousePos, activeRope, dt);
        }
        for (let ball of this.balls) {
            const v = ball.pos.clone().sub(ball.oldPos).multiplyScalar(0.99);
            ball.oldPos.copy(ball.pos);
            // Increased gravity multiplier for "heavier" feel
            ball.pos.add(v).add(new THREE.Vector2(0, this.gravity * 0.01));
        }

        // 2. Solver Loop
        const iterations = 40;
        for (let it = 0; it < iterations; it++) {
            // Sync attachments
            for (let web of this.webs) {
                for (let p of web.points) {
                    if (p.attachment) {
                        const att = p.attachment;
                        p.pos.lerpVectors(att.web.points[att.segmentIdx].pos, att.web.points[att.segmentIdx+1].pos, att.t);
                    }
                }
            }

            for (let web of this.webs) {
                this.solveWebConstraints(web, mousePos, activeRope);
                this.solveWebCollisions(web, mousePos, activeRope);
            }
            
            // Solve Ball-to-Ball collisions
            for (let i = 0; i < this.balls.length; i++) {
                for (let j = i + 1; j < this.balls.length; j++) {
                    this.solveBallBallCollisions(this.balls[i], this.balls[j]);
                }
            }

            for (let ball of this.balls) {
                this.solveBallSDFCollisions(ball);
                this.solveBallWebCollisions(ball, activeRope);
            }
        }

        // 3. Final visual updates
        for (let web of this.webs) this.updateVisuals(web);
        for (let ball of this.balls) ball.mesh.position.set(ball.pos.x, ball.pos.y, -0.5);
    }

    integrateWeb(web, mousePos, activeRope, dt) {
        const points = web.points;
        if (web === activeRope) {
            const actualDist = mousePos.distanceTo(points[0].pos);
            const idealSegs = Math.max(2, Math.ceil(Math.max(web.length, actualDist) / this.ropeSegLen));
            while (points.length < idealSegs) {
                const last = points[points.length - 1];
                points.push({ pos: last.pos.clone(), oldPos: last.pos.clone(), fixed: false, attachment: null });
            }
            while (points.length > idealSegs && points.length > 2) points.pop();
            points[points.length - 1].pos.copy(mousePos);
            points[points.length - 1].oldPos.copy(mousePos);
        }
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.attachment || p.fixed) continue;
            if (web === activeRope && i === points.length - 1) continue;
            const v = p.pos.clone().sub(p.oldPos).multiplyScalar(0.99);
            p.oldPos.copy(p.pos);
            p.pos.add(v).add(new THREE.Vector2(0, this.gravity * 0.005));
        }
    }

    solveWebConstraints(web, mousePos, activeRope) {
        const points = web.points;
        const segDist = web.length / (points.length - 1);
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i], p2 = points[i+1];
            const delta = p2.pos.clone().sub(p1.pos);
            const d = delta.length();
            if (d === 0) continue;
            const diff = (d - segDist) / d;
            let m1 = (p1.fixed || p1.attachment) ? 0 : 0.5;
            let m2 = (p2.fixed || p2.attachment) ? 0 : 0.5;
            if (web === activeRope && i + 1 === points.length - 1) m2 = 0;
            const shift = delta.multiplyScalar(diff);
            p1.pos.addScaledVector(shift, m1);
            p2.pos.addScaledVector(shift, -m2);
            if (p1.attachment && m1 === 0) {
                const att = p1.attachment;
                const pA = att.web.points[att.segmentIdx], pB = att.web.points[att.segmentIdx+1];
                if (!pA.fixed && !pA.attachment) pA.pos.addScaledVector(shift, 0.05 * (1 - att.t));
                if (!pB.fixed && !pB.attachment) pB.pos.addScaledVector(shift, 0.05 * att.t);
            }
        }
        if (web === activeRope) points[points.length - 1].pos.copy(mousePos);
    }

    solveWebCollisions(web, mousePos, activeRope) {
        const points = web.points;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.fixed || p.attachment) continue;
            if (web === activeRope && i === points.length - 1) continue;
            const d = this.worldSDF(p.pos);
            if (d < 0) {
                const normal = this.getNormal(p.pos);
                p.pos.addScaledVector(normal, -d + this.collisionMargin);
            }
        }
    }

    solveBallSDFCollisions(ball) {
        const d = this.worldSDF(ball.pos);
        if (d < ball.radius) {
            const normal = this.getNormal(ball.pos);
            ball.pos.addScaledVector(normal, ball.radius - d);
        }
    }

    solveBallBallCollisions(b1, b2) {
        const delta = b1.pos.clone().sub(b2.pos);
        const dist = delta.length();
        const minDist = b1.radius + b2.radius;
        if (dist < minDist) {
            const normal = delta.normalize();
            const overlap = minDist - dist;
            // Simple 50/50 split for same-mass inter-ball collision
            b1.pos.addScaledVector(normal, overlap * 0.5);
            b2.pos.addScaledVector(normal, -overlap * 0.5);
        }
    }

    solveBallWebCollisions(ball, activeRope) {
        for (let web of this.webs) {
            const points = web.points;
            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i], p2 = points[i+1];
                const lineDir = p2.pos.clone().sub(p1.pos);
                const lenSq = lineDir.lengthSq();
                if (lenSq < 0.001) continue;
                
                const t = Math.max(0, Math.min(1, ball.pos.clone().sub(p1.pos).dot(lineDir) / lenSq));
                const proj = p1.pos.clone().add(lineDir.multiplyScalar(t));
                const dist = ball.pos.distanceTo(proj);

                if (dist < ball.radius) {
                    const n = ball.pos.clone().sub(proj).normalize();
                    const overlap = ball.radius - dist;
                    
                    // Push ball LESS, push web MORE to simulate mass difference
                    // Increased ratio to reflect "2x mass" compared to before
                    ball.pos.addScaledVector(n, overlap * 0.25);
                    
                    const pushWeb = n.clone().multiplyScalar(-overlap * 0.75);
                    if (!p1.fixed && !p1.attachment) p1.pos.addScaledVector(pushWeb, 1 - t);
                    if (!p2.fixed && !p2.attachment && !(web === activeRope && i+1 === points.length-1)) p2.pos.addScaledVector(pushWeb, t);
                }
            }
        }
    }

    updateVisuals(web) {
        const attr = web.line.geometry.attributes.position;
        for (let i = 0; i < web.points.length; i++) attr.setXYZ(i, web.points[i].pos.x, web.points[i].pos.y, 0);
        attr.needsUpdate = true;
        web.line.geometry.setDrawRange(0, web.points.length);
    }

    findAnchor(pos) {
        const dist = this.worldSDF(pos);
        if (dist < 0.5) {
            const normal = this.getNormal(pos);
            return { pos: pos.clone().addScaledVector(normal, -dist), fixed: true, attachment: null };
        }
        for (let web of this.webs) {
            if (web.isBeingBuilt) continue;
            for (let i = 0; i < web.points.length - 1; i++) {
                const p1 = web.points[i].pos, p2 = web.points[i+1].pos;
                const lineDir = p2.clone().sub(p1);
                const lenSq = lineDir.lengthSq();
                if (lenSq < 0.001) continue;
                const t = Math.max(0, Math.min(1, pos.clone().sub(p1).dot(lineDir) / lenSq));
                const proj = p1.clone().add(lineDir.multiplyScalar(t));
                if (pos.distanceTo(proj) < 0.4) return { pos: proj, fixed: false, attachment: { web, segmentIdx: i, t } };
            }
        }
        return null;
    }
}