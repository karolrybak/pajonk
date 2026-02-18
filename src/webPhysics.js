import * as THREE from 'three';

export class WebPhysics {
    constructor(scene, bounds) {
        this.scene = scene;
        this.bounds = bounds;
        this.gravity = -18.0;
        this.webs = [];
        this.ropeSegLen = 0.25;
    }

    createWeb(startPos, isFixedToWall, attachment = null) {
        const points = [
            { pos: startPos.clone(), oldPos: startPos.clone(), fixed: isFixedToWall, attachment },
            { pos: startPos.clone(), oldPos: startPos.clone(), fixed: false, attachment: null }
        ];

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(1000 * 3), 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
        line.frustumCulled = false;
        this.scene.add(line);

        const web = {
            points,
            length: startPos.distanceTo(startPos) + 0.5,
            line,
            isBeingBuilt: true
        };
        this.webs.push(web);
        return web;
    }

    update(dt, mousePos, activeRope) {
        // Position Integration
        for (let web of this.webs) {
            this.integrate(web, mousePos, activeRope, dt);
        }

        // Solve constraints many times for extreme stiffness
        for (let it = 0; it < 25; it++) {
            for (let web of this.webs) {
                this.solveConstraints(web, mousePos, activeRope);
            }
        }
        
        // Final visual update
        for (let web of this.webs) {
            this.updateVisuals(web);
        }
    }

    integrate(web, mousePos, activeRope, dt) {
        const points = web.points;

        if (web === activeRope) {
            // Segment count ONLY depends on physical capacity, not stretch
            // This allows the PBD to actually 'pull' when overstretched
            const idealSegs = Math.max(2, Math.ceil(web.length / this.ropeSegLen));
            
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
                const p1 = att.web.points[att.segmentIdx].pos;
                const p2 = att.web.points[att.segmentIdx+1].pos;
                p.pos.lerpVectors(p1, p2, att.t);
                p.oldPos.copy(p.pos);
            } else if (!p.fixed) {
                if (web === activeRope && i === points.length - 1) continue;
                
                const v = p.pos.clone().sub(p.oldPos).multiplyScalar(0.99);
                p.oldPos.copy(p.pos);
                p.pos.add(v).add(new THREE.Vector2(0, this.gravity * 0.005));
            }
        }
    }

    solveConstraints(web, mousePos, activeRope) {
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
            
            // Apply movement
            p1.pos.addScaledVector(shift, m1);
            p2.pos.addScaledVector(shift, -m2);

            // Two-way propagation: If p1 is attached, the shift also pulls the parent web
            if (p1.attachment && m1 === 0) {
                const att = p1.attachment;
                const pA = att.web.points[att.segmentIdx];
                const pB = att.web.points[att.segmentIdx+1];
                const pull = 0.1; // Strength of the two-way pull
                if (!pA.fixed && !pA.attachment) pA.pos.addScaledVector(shift, pull * (1 - att.t));
                if (!pB.fixed && !pB.attachment) pB.pos.addScaledVector(shift, pull * att.t);
            }
        }

        // Re-lock points that must not move
        if (web === activeRope) {
            points[points.length - 1].pos.copy(mousePos);
        }
    }

    updateVisuals(web) {
        const attr = web.line.geometry.attributes.position;
        for (let i = 0; i < web.points.length; i++) {
            attr.setXYZ(i, web.points[i].pos.x, web.points[i].pos.y, 0);
        }
        attr.needsUpdate = true;
        web.line.geometry.setDrawRange(0, web.points.length);
    }

    findAnchor(pos) {
        const halfW = this.bounds.width / 2;
        const halfH = this.bounds.height / 2;
        if (Math.abs(pos.x) > halfW - 0.5 || Math.abs(pos.y) > halfH - 0.5) {
            const clamped = pos.clone();
            clamped.x = Math.max(-halfW, Math.min(halfW, clamped.x));
            clamped.y = Math.max(-halfH, Math.min(halfH, clamped.y));
            return { pos: clamped, fixed: true, attachment: null };
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
                if (pos.distanceTo(proj) < 0.5) {
                    return { pos: proj, fixed: false, attachment: { web, segmentIdx: i, t } };
                }
            }
        }
        return null;
    }
}