struct Particle {
    pos: vec2<f32>,
    oldPos: vec2<f32>,
    vel: vec2<f32>,
    invMass: f32,
    radius: f32,
};

struct Constraint {
    idxA: u32,
    idxB: u32,
    restLength: f32,
    compliance: f32,
    is_active: u32,
    padding: vec3<u32>,
};

struct Params {
    dt: f32,
    gravity: f32,
    numParticles: u32,
    numConstraints: u32,
    mousePos: vec2<f32>,
    activeParticleIdx: i32,
    substeps: u32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> constraints: array<Constraint>;
@group(0) @binding(2) var<uniform> params: Params;

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numParticles) { return; }
    
    var p = particles[i];
    if (p.invMass <= 0.0) {
        if (i == u32(params.activeParticleIdx)) {
             particles[i].pos = params.mousePos;
             particles[i].oldPos = params.mousePos;
        }
        return;
    }

    let h = params.dt / f32(params.substeps);
    let vel = (p.pos - p.oldPos) / h;
    let nextPos = p.pos + vel * h + vec2<f32>(0.0, params.gravity) * h * h;
    
    particles[i].oldPos = p.pos;
    particles[i].pos = nextPos;
}

@compute @workgroup_size(64)
fn solveDistance(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numConstraints) { return; }
    
    let c = constraints[i];
    if (c.is_active == 0u) { return; }

    let p1 = particles[c.idxA].pos;
    let p2 = particles[c.idxB].pos;
    let w1 = particles[c.idxA].invMass;
    let w2 = particles[c.idxB].invMass;
    let wSum = w1 + w2;
    if (wSum <= 0.0) { return; }

    let delta = p1 - p2;
    let dist = length(delta);
    if (dist < 0.0001) { return; }

    let h = params.dt / f32(params.substeps);
    let alpha = c.compliance / (h * h);
    let dLambda = -(dist - c.restLength) / (wSum + alpha);
    
    let correction = delta * (dLambda / dist);

    if (w1 > 0.0) { particles[c.idxA].pos += correction * w1; }
    if (w2 > 0.0) { particles[c.idxB].pos -= correction * w2; }
}

@compute @workgroup_size(64)
fn solveCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numParticles) { return; }
    
    var p = particles[i];
    if (p.invMass <= 0.0) { return; }

    // Arena collision (Box SDF inverse)
    let bounds = vec2<f32>(11.8, 6.8); // Slightly inside BOUNDS
    let d = sdBox(p.pos, bounds);
    if (d > 0.0) {
        // Simplified normal: find closest edge
        if (abs(p.pos.x) > bounds.x) { p.pos.x = sign(p.pos.x) * bounds.x; }
        if (abs(p.pos.y) > bounds.y) { p.pos.y = sign(p.pos.y) * bounds.y; }
    }
    
    particles[i] = p;
}