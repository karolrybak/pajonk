struct Particle {
    pos: vec2<f32>,
    oldPos: vec2<f32>,
    isFree: f32,
    friction: f32,
    invMass: f32,
    radius: f32,
};

struct DistanceConstraint {
    idxA: u32,
    idxB: u32,
    restLength: f32,
    compliance: f32,
    color: u32,
    pad1: u32,
    pad2: u32,
    pad3: u32,
};

struct Attachment {
    pIdx: u32,
    aIdx: u32,
    bIdx: u32,
    t: f32,
};

struct Obstacle {
    pos: vec2<f32>,
    size: vec2<f32>, 
    type_id: u32,    
    rotation: f32,   
    extra: vec2<f32>,
};

struct Params {
    dt: f32,
    gravity: f32,
    numParticles: u32,
    numDistConstraints: u32,
    substeps: u32,
    phase: u32,
    mousePos: vec2<f32>,
    activeParticleIdx: i32,
    numAttachments: u32,
    damping: f32,
    paused: u32,
    numObstacles: u32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> distConstraints: array<DistanceConstraint>;
@group(0) @binding(2) var<storage, read> attachments: array<Attachment>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> obstacles: array<Obstacle>;

fn rotate(v: vec2<f32>, angle: f32) -> vec2<f32> {
    let s = sin(angle);
    let c = cos(angle);
    return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}

fn sdUnevenCapsule(p: vec2<f32>, r1: f32, r2: f32, h: f32) -> f32 {
    let px = abs(p.x);
    let b = (r1 - r2) / h;
    let a = sqrt(max(0.0, 1.0 - b * b));
    let k = dot(vec2<f32>(px, p.y), vec2<f32>(-b, a));
    if (k < 0.0) { return length(vec2<f32>(px, p.y)) - r1; }
    if (k > a * h) { return length(vec2<f32>(px, p.y - h)) - r2; }
    return dot(vec2<f32>(px, p.y), vec2<f32>(a, b)) - r1;
}

fn sdVesica(p: vec2<f32>, r: f32, d: f32) -> f32 {
    let pa = abs(p);
    let b = sqrt(max(0.0, r * r - d * d));
    return select(length(pa - vec2<f32>(-d, 0.0)) - r, length(pa - vec2<f32>(0.0, b)), pa.y * d > pa.x * b + d * d);
}

fn getSDF(p: vec2<f32>, obs: Obstacle) -> f32 {
    let localP = rotate(p - obs.pos, -obs.rotation);
    if (obs.type_id == 0u) {
        return length(localP) - obs.size.x;
    } else if (obs.type_id == 1u) {
        let d = abs(localP) - obs.size * 0.5;
        return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
    } else if (obs.type_id == 2u) {
        return sdRoundedBox(localP, obs.size * 0.5, obs.extra.x);
    } else if (obs.type_id == 3u) {
        return sdUnevenCapsule(localP, obs.size.x, obs.size.y, obs.extra.x);
    } else if (obs.type_id == 4u) {
        return sdVesica(localP, obs.size.x, obs.size.y);
    }
    return 1000.0;
}

fn getInvMass(i: u32) -> f32 {
    let p = particles[i];
    if (params.paused == 1u && p.isFree == 0.0 && i != u32(params.activeParticleIdx)) {
        return 0.0;
    }
    return p.invMass;
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numParticles) { return; }
    var p = particles[i];
    if (i == u32(params.activeParticleIdx)) {
        particles[i].pos = params.mousePos;
        particles[i].oldPos = params.mousePos;
        return;
    }
    if (params.paused == 1u && p.isFree == 0.0) {
        particles[i].oldPos = p.pos;
        return;
    }
    if (p.invMass <= 0.0) { return; }
    let h = params.dt / f32(params.substeps);
    var vel = (p.pos - p.oldPos) / h;
    vel = vel * params.damping;
    vel = vel + vec2<f32>(0.0, params.gravity) * h;
    particles[i].oldPos = p.pos;
    particles[i].pos = p.pos + vel * h;
}

@compute @workgroup_size(64)
fn solveDistance(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numDistConstraints) { return; }
    let c = distConstraints[i];
    if (c.idxA == c.idxB || c.color != params.phase) { return; }
    let w1 = getInvMass(c.idxA); 
    let w2 = getInvMass(c.idxB);
    let wSum = w1 + w2; if (wSum <= 0.0) { return; }
    let delta = particles[c.idxA].pos - particles[c.idxB].pos;
    let dist = length(delta); if (dist < 0.0001) { return; }
    let h = params.dt / f32(params.substeps);
    let alpha = c.compliance / (h * h);
    let dLambda = -(dist - c.restLength) / (wSum + alpha);
    let correction = delta * (dLambda / dist);
    if (w1 > 0.0) { particles[c.idxA].pos += correction * w1; }
    if (w2 > 0.0) { particles[c.idxB].pos -= correction * w2; }
}

@compute @workgroup_size(64)
fn solveAttachments(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= params.numAttachments) { return; }
    let att = attachments[i];
    let p = particles[att.pIdx].pos;
    let a = particles[att.aIdx].pos;
    let b = particles[att.bIdx].pos;
    let link_target = mix(a, b, att.t);
    let delta = p - link_target; let dist = length(delta); if (dist < 0.00001) { return; }
    let wp = getInvMass(att.pIdx); 
    let wa = getInvMass(att.aIdx); 
    let wb = getInvMass(att.bIdx);
    let wSum = wp + wa * (1.0 - att.t) * (1.0 - att.t) + wb * att.t * att.t;
    if (wSum <= 0.0) { return; }
    let correction = normalize(delta) * (-dist / wSum);
    if (wp > 0.0) { particles[att.pIdx].pos += correction * wp; }
    if (wa > 0.0) { particles[att.aIdx].pos -= correction * wa * (1.0 - att.t); }
    if (wb > 0.0) { particles[att.bIdx].pos -= correction * wb * att.t; }
}

// ============================================
// KOLIZJE - TYLKO POZYCJE (BEZ TARCIA)
// ============================================

@compute @workgroup_size(64)
fn solveCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= params.numParticles) { return; }
    var p = particles[i]; 
    let invMassI = getInvMass(i);
    if (invMassI <= 0.0) { return; }

    // Boundary Collisions - TYLKO pozycja
    let bx = 11.8; let by = 6.8;
    if (p.pos.x > bx - p.radius) { p.pos.x = bx - p.radius; p.oldPos.x = p.pos.x; }
    if (p.pos.x < -bx + p.radius) { p.pos.x = -bx + p.radius; p.oldPos.x = p.pos.x; }
    if (p.pos.y > by - p.radius) { p.pos.y = by - p.radius; p.oldPos.y = p.pos.y; }
    if (p.pos.y < -by + p.radius) { p.pos.y = -by + p.radius; p.oldPos.y = p.pos.y; }

    for (var j: u32 = 0u; j < params.numObstacles; j++) {
        let obs = obstacles[j];
        let d = getSDF(p.pos, obs);
        if (d < p.radius) {
            let h = 0.01;
            let dx = getSDF(p.pos + vec2<f32>(h, 0.0), obs) - d;
            let dy = getSDF(p.pos + vec2<f32>(0.0, h), obs) - d;
            let n = normalize(vec2<f32>(dx, dy));
            let overlap = p.radius - d;
            p.pos = p.pos + n * overlap;
            
            let dp = p.pos - p.oldPos;
            let dpT = dp - dot(dp, n) * n;
            let dpTLen = length(dpT);
            if (dpTLen > 0.0001) {
                let fric = obs.extra.y;
                let force = min(fric * overlap, dpTLen);
                p.oldPos += (dpT / dpTLen) * force;
            }
        }
    }
    particles[i].pos = p.pos;
}

@compute @workgroup_size(64)
fn solveParticleCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= params.numParticles) { return; }
    var pi = particles[i]; 
    let w1 = getInvMass(i);
    if (w1 <= 0.0) { return; }
    
    for (var j: u32 = 0u; j < params.numParticles; j++) {
        if (i == j) { continue; }
        let pj = particles[j];
        let delta = pi.pos - pj.pos; let dist = length(delta); let minDist = pi.radius + pj.radius;
        if (dist < minDist && dist > 0.0001) {
            let w2 = getInvMass(j);
            let wSum = w1 + w2;
            if (wSum > 0.0) { 
                let n = delta / dist; let overlap = minDist - dist; 
                pi.pos += n * (overlap / wSum) * w1 * 0.5; 
                
                let dp = pi.pos - pi.oldPos;
                let dpT = dp - dot(dp, n) * n;
                let dpTLen = length(dpT);
                if (dpTLen > 0.0001) {
                    let fric = (pi.friction + pj.friction) * 0.5;
                    let force = min(fric * overlap, dpTLen);
                    pi.oldPos += (dpT / dpTLen) * force * (w1 / wSum);
                }
            }
        }
    }
    particles[i].pos = pi.pos;
}

// ============================================
// TARCIE - OSOBNY PASS
// ============================================

@compute @workgroup_size(64)
fn applyFriction(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= params.numParticles) { return; }
    
    var p = particles[i];
    let w1 = getInvMass(i);
    if (w1 <= 0.0) { return; }
    
    let vel = p.pos - p.oldPos;
    let velLen = length(vel);
    if (velLen < 0.0001) { return; }
    
    var newOldPos = p.oldPos;
    let h = params.dt / f32(params.substeps);

    // --- Tarcie z boundary ---
    let bx = 11.8; let by = 6.8;
    let walls = array<vec3<f32>, 4>(
        vec3<f32>(-1.0, 0.0, bx),
        vec3<f32>(1.0, 0.0, bx),
        vec3<f32>(0.0, -1.0, by),
        vec3<f32>(0.0, 1.0, by)
    );

    for (var k: u32 = 0u; k < 4u; k++) {
        let wall = walls[k];
        let n = vec2<f32>(wall.x, wall.y);
        let limit = wall.z;
        
        // Czy dotykamy ściany? (mały epsilon dla stabilności)
        if (dot(p.pos, -n) > limit - p.radius - 0.001) {
            let vn = dot(vel, n);      // składowa normalna
            let vt = vel - n * vn;     // składowa styczna
            let vtLen = length(vt);
            
            if (vtLen > 0.0001) {
                // Tarcie Coulomba: redukujemy prędkość styczną
                // friction 0.0 = ślisko, 1.0 = pełne zatrzymanie
                let frictionFactor = max(0.0, 1.0 - p.friction);
                let newVel = n * vn + vt * frictionFactor;
                newOldPos = p.pos - newVel;
            }
        }
    }

    // --- Tarcie z obstacles ---
    for (var j: u32 = 0u; j < params.numObstacles; j++) {
        let obs = obstacles[j];
        let d = getSDF(p.pos, obs);
        
        if (d < p.radius + 0.001) {
            let h_sdf = 0.001;
            let n = normalize(vec2<f32>(
                getSDF(p.pos + vec2<f32>(h_sdf, 0.0), obs) - d,
                getSDF(p.pos + vec2<f32>(0.0, h_sdf), obs) - d
            ));
            
            let vn = dot(vel, n);
            let vt = vel - n * vn;
            let vtLen = length(vt);
            
            if (vtLen > 0.0001) {
                let obsFriction = obs.extra.y;
                let frictionFactor = max(0.0, 1.0 - obsFriction);
                let newVel = n * vn + vt * frictionFactor;
                newOldPos = p.pos - newVel;
            }
        }
    }

    particles[i].oldPos = newOldPos;
}

@compute @workgroup_size(64)
fn applyParticleFriction(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= params.numParticles) { return; }
    
    var p = particles[i];
    let w1 = getInvMass(i);
    if (w1 <= 0.0) { return; }
    
    let velI = p.pos - p.oldPos;
    var newVel = velI;
    
    for (var j: u32 = 0u; j < params.numParticles; j++) {
        if (i == j) { continue; }
        
        let pj = particles[j];
        let delta = p.pos - pj.pos;
        let dist = length(delta);
        let minDist = p.radius + pj.radius;
        
        // Czy się stykamy?
        if (dist < minDist + 0.001 && dist > 0.0001) {
            let w2 = getInvMass(j);
            if (w2 <= 0.0) { continue; }
            
            let n = delta / dist;
            let velJ = pj.pos - pj.oldPos;
            
            // Względna prędkość
            let relVel = newVel - velJ;
            let vn = dot(relVel, n);
            let vt = relVel - n * vn;
            let vtLen = length(vt);
            
            if (vtLen > 0.0001) {
                let avgFriction = (p.friction + pj.friction) * 0.5;
                
                // Redukcja względnej prędkości stycznej
                let frictionFactor = max(0.0, 1.0 - avgFriction);
                let newRelVel = n * vn + vt * frictionFactor;
                
                // newVel - velJ = newRelVel  =>  newVel = newRelVel + velJ
                newVel = newRelVel + velJ;
            }
        }
    }
    
    particles[i].oldPos = p.pos - newVel;
}