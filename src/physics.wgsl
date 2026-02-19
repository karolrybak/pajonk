struct Particle {
    pos: vec2<f32>,
    oldPos: vec2<f32>,
    isFree: f32,
    pad: f32,
    invMass: f32,
    radius: f32,
};

struct DistanceConstraint {
    idxA: u32,
    idxB: u32,
    restLength: f32,
    compliance: f32,
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
    padding: vec2<f32>,
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
    if (i >= params.numDistConstraints || i % 2u != params.phase) { return; }
    let c = distConstraints[i];
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

@compute @workgroup_size(64)
fn solveCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= params.numParticles) { return; }
    var p = particles[i]; 
    let invMassI = getInvMass(i);
    if (invMassI <= 0.0) { return; }

    let bx = 11.8; let by = 6.8;
    if (p.pos.x > bx - p.radius) { p.pos.x = bx - p.radius; p.oldPos.x = p.pos.x; }
    if (p.pos.x < -bx + p.radius) { p.pos.x = -bx + p.radius; p.oldPos.x = p.pos.x; }
    if (p.pos.y > by - p.radius) { p.pos.y = by - p.radius; p.oldPos.y = p.pos.y; }
    if (p.pos.y < -by + p.radius) { p.pos.y = -by + p.radius; p.oldPos.y = p.pos.y; }

    for (var j: u32 = 0u; j < params.numObstacles; j++) {
        let obs = obstacles[j];
        if (obs.type_id == 0u) { 
            let toP = p.pos - obs.pos;
            let dist = length(toP);
            if (dist < obs.size.x + p.radius) {
                p.pos = obs.pos + normalize(toP) * (obs.size.x + p.radius);
                p.oldPos = p.pos;
            }
        } else {
            let localP = rotate(p.pos - obs.pos, -obs.rotation);
            let half = obs.size * 0.5;
            let d = abs(localP) - half;
            let dist = length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
            if (dist < p.radius) {
                let n_local = select(vec2<f32>(sign(localP).x, 0.0), vec2<f32>(0.0, sign(localP).y), d.y > d.x);
                let p_local_fixed = localP + n_local * (p.radius - dist);
                p.pos = obs.pos + rotate(p_local_fixed, obs.rotation);
                p.oldPos = p.pos;
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
            }
        }
    }
    particles[i].pos = pi.pos;
}