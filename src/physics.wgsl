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
    phase: u32, // 0 for even constraints, 1 for odd
    mousePos: vec2<f32>,
    activeParticleIdx: i32,
    padding: i32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> distConstraints: array<DistanceConstraint>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numParticles) { return; }
    
    if (i == u32(params.activeParticleIdx)) {
        particles[i].pos = params.mousePos;
        particles[i].oldPos = params.mousePos;
        return;
    }

    var p = particles[i];
    if (p.invMass <= 0.0) { return; }

    let h = params.dt / f32(params.substeps);
    var vel = (p.pos - p.oldPos) / h;
    
    // Gentle damping to prevent jitter, not to mask physics
    vel = vel * 0.998;
    vel = vel + vec2<f32>(0.0, params.gravity) * h;

    let nextPos = p.pos + vel * h;
    
    particles[i].oldPos = p.pos;
    particles[i].pos = nextPos;
}

@compute @workgroup_size(64)
fn solveDistance(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numDistConstraints) { return; }
    
    // Graph Coloring: Sequential processing per phase to avoid race conditions
    if (i % 2u != params.phase) { return; }
    
    let c = distConstraints[i];
    let p1 = particles[c.idxA].pos;
    let p2 = particles[c.idxB].pos;
    let w1 = particles[c.idxA].invMass;
    let w2 = particles[c.idxB].invMass;
    let wSum = w1 + w2;
    
    if (wSum <= 0.0) { return; }

    let delta = p1 - p2;
    let dist = length(delta);
    if (dist < 0.000001) { return; }

    let h = params.dt / f32(params.substeps);
    let alpha = c.compliance / (h * h);
    let dLambda = -(dist - c.restLength) / (wSum + alpha);
    let correction = delta * (dLambda / dist);

    // In Gauss-Seidel mode (sequential phases), we use 1.0 weight for perfect stiffness
    if (w1 > 0.0) { particles[c.idxA].pos += correction * w1; }
    if (w2 > 0.0) { particles[c.idxB].pos -= correction * w2; }
}

@compute @workgroup_size(64)
fn solveCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numParticles) { return; }
    
    var p = particles[i];
    if (p.invMass <= 0.0) { return; }

    let bx = 11.9;
    let by = 6.9;
    
    if (p.pos.x > bx) { p.pos.x = bx; }
    if (p.pos.x < -bx) { p.pos.x = -bx; }
    if (p.pos.y > by) { p.pos.y = by; }
    if (p.pos.y < -by) { p.pos.y = -by; }

    let circlePos = vec2<f32>(4.0, 2.0);
    let circleRad = 1.5;
    let distToC = length(p.pos - circlePos);
    if (distToC < circleRad + p.radius) {
        let n = normalize(p.pos - circlePos);
        p.pos = circlePos + n * (circleRad + p.radius);
    }

    particles[i].pos = p.pos;
}