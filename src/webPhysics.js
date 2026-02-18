import * as THREE from 'three';

export class WebPhysics {
    constructor(scene, bounds) {
        this.scene = scene;
        this.bounds = bounds;
        this.gravity = -18.0;
        this.webs = [];
        this.ropeSegLen = 0.15; // Higher resolution for better collision fidelity
        this.collisionMargin = 0.02;
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
        // The box from the screenshot
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

    update(dt, mousePos, activeRope) {
        for (let web of this.webs) {
            this.integrate(web, mousePos, activeRope, dt);
        }
        // Drastically increased iterations for high-fidelity constraints and collisions
        const iterations = 60;
        for (let it = 0; it < iterations; it++) {
            for (let web of this.webs) {
                this.solveConstraints(web, mousePos, activeRope);
            }
        }
        for (let web of this.webs) {
            this.updateVisuals(web);
        }
    }

    integrate(web, mousePos, activeRope, dt) {
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
            if (p.attachment) {
                const att = p.attachment;
                p.pos.lerpVectors(att.web.points[att.segmentIdx].pos, att.web.points[att.segmentIdx+1].pos, att.t);
                p.oldPos.copy(p.pos);
            } else if (!p.fixed) {
                if (web === activeRope && i === points.length - 1) continue;
                const v = p.pos.clone().sub(p.oldPos).multiplyScalar(0.995);
                p.oldPos.copy(p.pos);
                p.pos.add(v).add(new THREE.Vector2(0, this.gravity * 0.005));
            }
        }
    }

    solveConstraints(web, mousePos, activeRope) {
        const points = web.points;
        const segDist = web.length / (points.length - 1);

        // 1. First pass: Handle attachments and collisions inside the loop
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.attachment) {
                const att = p.attachment;
                p.pos.lerpVectors(att.web.points[att.segmentIdx].pos, att.web.points[att.segmentIdx+1].pos, att.t);
            } else if (!p.fixed) {
                if (web === activeRope && i === points.length - 1) continue;
                const d = this.worldSDF(p.pos);
                if (d < 0) {
                    const normal = this.getNormal(p.pos);
                    p.pos.addScaledVector(normal, -d + this.collisionMargin);
                }
            }
        }

        // 2. Second pass: Solve distance constraints
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

            // Two-way propagation for attachments
            if (p1.attachment && m1 === 0) {
                const att = p1.attachment;
                const pA = att.web.points[att.segmentIdx];
                const pB = att.web.points[att.segmentIdx+1];
                const pull = 0.05; 
                if (!pA.fixed && !pA.attachment) pA.pos.addScaledVector(shift, pull * (1 - att.t));
                if (!pB.fixed && !pB.attachment) pB.pos.addScaledVector(shift, pull * att.t);
            }
        }

        if (web === activeRope) points[points.length - 1].pos.copy(mousePos);
    }

    updateVisuals(web) {
        const attr = web.line.geometry.attributes.position;
        for (let i = 0; i < web.points.length; i++) attr.setXYZ(i, web.points[i].pos.x, web.points[i].pos.y, 0);
        attr.needsUpdate = true;
        web.line.geometry.setDrawRange(0, web.points.length);
    }

    findAnchor(pos) {
        const dist = this.worldSDF(pos);
        if (dist < 0.3) {
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
                if (pos.distanceTo(proj) < 0.3) return { pos: proj, fixed: false, attachment: { web, segmentIdx: i, t } };
            }
        }
        return null;
    }
}