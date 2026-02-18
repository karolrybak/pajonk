struct Particle {
    pos: vec2<f32>,
    oldPos: vec2<f32>,
    vel: vec2<f32>,
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
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> distConstraints: array<DistanceConstraint>;
@group(0) @binding(2) var<storage, read> attachments: array<Attachment>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numParticles) { return; }
    
    var p = particles[i];
    if (abs(p.pos.x) > 1000.0 || abs(p.pos.y) > 1000.0) {
        particles[i].pos = vec2<f32>(0.0, 0.0);
        particles[i].oldPos = vec2<f32>(0.0, 0.0);
        return;
    }

    if (i == u32(params.activeParticleIdx)) {
        particles[i].pos = params.mousePos;
        particles[i].oldPos = params.mousePos;
        particles[i].vel = vec2<f32>(0.0);
        return;
    }

    if (p.invMass <= 0.0) { return; }

    let h = params.dt / f32(params.substeps);
    var vel = (p.pos - p.oldPos) / h;
    vel = vel * 0.999;
    vel = vel + vec2<f32>(0.0, params.gravity) * h;

    let nextPos = p.pos + vel * h;
    particles[i].oldPos = p.pos;
    particles[i].pos = nextPos;
    particles[i].vel = vel;
}

@compute @workgroup_size(64)
fn solveDistance(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numDistConstraints) { return; }
    if (i % 2u != params.phase) { return; }
    
    let c = distConstraints[i];
    let w1 = particles[c.idxA].invMass;
    let w2 = particles[c.idxB].invMass;
    let wSum = w1 + w2;
    if (wSum <= 0.0) { return; }

    let delta = particles[c.idxA].pos - particles[c.idxB].pos;
    let dist = length(delta);
    if (dist < 0.0001) { return; }

    let h = params.dt / f32(params.substeps);
    let alpha = c.compliance / (h * h);
    let dLambda = -(dist - c.restLength) / (wSum + alpha);
    
    var correction = delta * (dLambda / dist);
    if (w1 > 0.0) { particles[c.idxA].pos += correction * w1; }
    if (w2 > 0.0) { particles[c.idxB].pos -= correction * w2; }
}

@compute @workgroup_size(64)
fn solveAttachments(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numAttachments) { return; }
    
    let att = attachments[i];
    let p = particles[att.pIdx].pos;
    let a = particles[att.aIdx].pos;
    let b = particles[att.bIdx].pos;
    
    let link_target = mix(a, b, att.t);
    let delta = p - link_target;
    let dist = length(delta);
    if (dist < 0.0001) { return; }

    let wp = particles[att.pIdx].invMass;
    let wa = particles[att.aIdx].invMass;
    let wb = particles[att.bIdx].invMass;
    
    // Barycentric inverse mass approximation for segment interaction
    let wSegment = wa * (1.0 - att.t) + wb * att.t;
    let wSum = wp + wSegment;
    if (wSum <= 0.0) { return; }

    let h = params.dt / f32(params.substeps);
    let alpha = 0.0; // Rigid attachment
    let dLambda = -dist / (wSum + alpha);
    let correction = normalize(delta) * dLambda;

    if (wp > 0.0) { particles[att.pIdx].pos += correction * wp; }
    if (wa > 0.0) { particles[att.aIdx].pos -= correction * wa * (1.0 - att.t); }
    if (wb > 0.0) { particles[att.bIdx].pos -= correction * wb * att.t; }
}

@compute @workgroup_size(64)
fn solveCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numParticles) { return; }
    var p = particles[i];
    if (p.invMass <= 0.0) { return; }

    let bx = 11.8;
    let by = 6.8;
    if (p.pos.x > bx) { p.pos.x = bx; }
    if (p.pos.x < -bx) { p.pos.x = -bx; }
    if (p.pos.y > by) { p.pos.y = by; }
    if (p.pos.y < -by) { p.pos.y = -by; }

    let circlePos = vec2<f32>(4.0, 2.0);
    let circleRad = 1.5;
    let toC = p.pos - circlePos;
    let dist = length(toC);
    if (dist < circleRad + p.radius) {
        p.pos = circlePos + normalize(toC) * (circleRad + p.radius);
    }

    particles[i].pos = p.pos;
}