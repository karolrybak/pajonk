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
    
    // Snap to mouse if active
    if (i == u32(params.activeParticleIdx)) {
        particles[i].pos = params.mousePos;
        particles[i].oldPos = params.mousePos;
        particles[i].vel = vec2<f32>(0.0);
        return;
    }

    var p = particles[i];
    if (p.invMass <= 0.0) { return; }

    let h = params.dt / f32(params.substeps);
    var vel = (p.pos - p.oldPos) / h;
    
    // Velocity Clamping to prevent explosions
    let speed = length(vel);
    if (speed > 100.0) {
        vel = normalize(vel) * 100.0;
    }

    // Damping & Gravity
    vel = vel * 0.992;
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
    
    // Jacobi-style damping (0.5) prevents oscillation fighting on GPU
    let correction = delta * (dLambda / dist) * 0.5;

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
    let bx = 11.8;
    let by = 6.8;
    
    if (p.pos.x > bx) { p.pos.x = bx; }
    if (p.pos.x < -bx) { p.pos.x = -bx; }
    if (p.pos.y > by) { p.pos.y = by; }
    if (p.pos.y < -by) { p.pos.y = -by; }

    // Circle Obstacle Collision (SDF)
    let circlePos = vec2<f32>(4.0, 2.0);
    let circleRad = 1.5;
    let distToC = length(p.pos - circlePos);
    if (distToC < circleRad + p.radius) {
        let n = normalize(p.pos - circlePos);
        p.pos = circlePos + n * (circleRad + p.radius);
    }

    particles[i].pos = p.pos;
}