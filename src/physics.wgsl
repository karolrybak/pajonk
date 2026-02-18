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

struct Params {
    dt: f32,
    gravity: f32,
    numParticles: u32,
    numDistConstraints: u32,
    substeps: u32,
    padding1: u32,
    mousePos: vec2<f32>,
    activeParticleIdx: i32,
    padding2: i32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> distConstraints: array<DistanceConstraint>;
@group(0) @binding(2) var<uniform> params: Params;

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
    var vel = (p.pos - p.oldPos) / h;
    
    // Damping
    vel = vel * 0.995;
    
    // Gravity
    vel = vel + vec2<f32>(0.0, params.gravity) * h;

    let nextPos = p.pos + vel * h;
    
    particles[i].oldPos = p.pos;
    particles[i].pos = nextPos;
}

@compute @workgroup_size(64)
fn solveDistance(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numDistConstraints) { return; }
    
    let c = distConstraints[i];
    let p1 = particles[c.idxA].pos;
    let p2 = particles[c.idxB].pos;
    let w1 = particles[c.idxA].invMass;
    let w2 = particles[c.idxB].invMass;
    let wSum = w1 + w2;
    
    if (wSum <= 0.0) { return; }

    let delta = p1 - p2;
    let dist = length(delta);
    if (dist < 0.00001) { return; }

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

    // Arena hard limits
    let bx = 11.5;
    let by = 6.5;
    
    // Simple projection without killing velocity (sliding)
    if (p.pos.x > bx) { p.pos.x = bx; }
    if (p.pos.x < -bx) { p.pos.x = -bx; }
    if (p.pos.y > by) { p.pos.y = by; }
    if (p.pos.y < -by) { p.pos.y = -by; }

    particles[i].pos = p.pos;
    // DO NOT RESET oldPos here, allows sliding/bouncing
}