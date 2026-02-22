struct Particle {
    pos: vec2<f32>,
    prevPos: vec2<f32>,
    mass: f32,
    friction: f32,
    radius: f32,
    object_data: u32,
};

struct Constraint {
    idxA: i32,
    idxB: i32,
    color: i32,
    cType: u32,
    restValue: f32,
    compliance: f32,
    extra: vec2<f32>,
};

struct Obstacle {
    pos: vec2<f32>,
    rotation: f32,
    object_data: u32,
    params: vec4<f32>,
};

struct Params {
    dt: f32,
    substeps: u32,
    gravity: vec2<f32>,
    worldBounds: vec4<f32>,
    collisionIterations: u32,
    numObstacles: u32,
    isPaused: u32,
    phase: u32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> constraints: array<Constraint>;
@group(0) @binding(2) var<storage, read> obstacles: array<Obstacle>;
@group(0) @binding(3) var<uniform> params: Params;

fn rotate(v: vec2<f32>, angle: f32) -> vec2<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);
}

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

fn getSDF(p: vec2<f32>, obs: Obstacle) -> f32 {
    let localP = rotate(p - obs.pos, -obs.rotation);
    let type_id = obs.object_data & 0xFFu;
    let appearance = (obs.object_data >> 8u) & 0xFFu;

    var d = 1000.0;
    if (appearance == 7u) { return -sdBox(localP, obs.params.xy * 0.5); }
    if (type_id == 0u) { d = length(localP) - obs.params.x; }
    else if (type_id == 1u) { d = sdBox(localP, obs.params.xy * 0.5); }
    return d;
}

fn getInvMass(i: u32) -> f32 {
    let p = particles[i];
    let flags = (p.object_data >> 16u) & 0xFFu;
    let simAlways = (flags & 2u) != 0u;
    if (params.isPaused == 1u && !simAlways) { return 0.0; }
    if (p.mass <= 0.0) { return 0.0; }
    return 1.0 / p.mass;
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= arrayLength(&particles)) { return; }
    let w = getInvMass(i);
    if (w <= 0.0) {
        particles[i].prevPos = particles[i].pos;
        return;
    }
    let temp = particles[i].pos;
    let vel = particles[i].pos - particles[i].prevPos;
    particles[i].pos += vel + params.gravity * params.dt * params.dt;
    particles[i].prevPos = temp;
}

@compute @workgroup_size(64)
fn solveConstraints(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= arrayLength(&constraints)) { return; }
    let c = constraints[i]; if (c.idxA < 0 || u32(c.color) != params.phase) { return; }
    
    let w1 = getInvMass(u32(c.idxA));
    var w2 = 0.0;
    var pB: vec2<f32>;
    
    if (c.idxB >= 0) {
        w2 = getInvMass(u32(c.idxB));
        pB = particles[u32(c.idxB)].pos;
    } else {
        pB = c.extra;
    }
    
    let wSum = w1 + w2; if (wSum <= 0.0) { return; }
    let delta = particles[u32(c.idxA)].pos - pB;
    let dist = length(delta); if (dist < 0.0001) { return; }
    
    let h = params.dt / f32(params.substeps);
    let alpha = c.compliance / (h * h);
    let dLambda = -(dist - c.restValue) / (wSum + alpha);
    let corr = delta * (dLambda / dist);
    
    if (w1 > 0.0) { particles[u32(c.idxA)].pos += corr * w1; }
    if (c.idxB >= 0 && w2 > 0.0) { particles[u32(c.idxB)].pos -= corr * w2; }
}

@compute @workgroup_size(64)
fn solveCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= arrayLength(&particles)) { return; }
    var p = particles[i]; let w = getInvMass(i);
    if (w <= 0.0) { return; }

    for (var j: u32 = 0u; j < params.numObstacles; j++) {
        let obs = obstacles[j];
        let d = getSDF(p.pos, obs);
        if (d < p.radius) {
            let h = 0.001;
            let n = normalize(vec2<f32>(
                getSDF(p.pos + vec2<f32>(h, 0.0), obs) - d,
                getSDF(p.pos + vec2<f32>(0.0, h), obs) - d
            ));
            p.pos += n * (p.radius - d);
        }
    }
    particles[i].pos = p.pos;
}

@compute @workgroup_size(64)
fn solveParticleCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= arrayLength(&particles)) { return; }
    var pi = particles[i]; let w1 = getInvMass(i);
    if (w1 <= 0.0) { return; }

    let max_iter = min(arrayLength(&particles), 256u);
    for (var j: u32 = 0u; j < max_iter; j++) {
        if (i == j) { continue; }
        let pj = particles[j]; if (pj.mass <= 0.0) { continue; }
        let delta = pi.pos - pj.pos; let dist = length(delta); let minDist = pi.radius + pj.radius;
        if (dist < minDist && dist > 0.0001) {
            let w2 = getInvMass(j); let wSum = w1 + w2;
            if (wSum > 0.0) { 
                let n = delta / dist; pi.pos += n * (minDist - dist) * (w1 / wSum);
            }
        }
    }
    particles[i].pos = pi.pos;
}

@compute @workgroup_size(64)
fn applyFriction(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= arrayLength(&particles)) { return; }
    var p = particles[i]; let w = getInvMass(i); if (w <= 0.0) { return; }
    let vel = p.pos - p.prevPos; let velLen = length(vel); if (velLen < 0.0001) { return; }
    
    var newPrev = p.prevPos;
    for (var j: u32 = 0u; j < params.numObstacles; j++) {
        let obs = obstacles[j];
        let d = getSDF(p.pos, obs);
        if (d < p.radius + 0.005) {
            let h = 0.001;
            let n = normalize(vec2<f32>(getSDF(p.pos + vec2<f32>(h,0.0), obs) - d, getSDF(p.pos + vec2<f32>(0.0,h), obs) - d));
            let vn = dot(vel, n); let vt = vel - n * vn; let vtLen = length(vt);
            if (vtLen > 0.0001) {
                let obsFric = f32((obs.object_data >> 24u) & 0xFFu) / 255.0;
                newPrev = p.pos - (n * vn + vt * max(0.0, 1.0 - obsFric));
            }
        }
    }
    particles[i].prevPos = newPrev;
}

@compute @workgroup_size(64)
fn applyParticleFriction(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= arrayLength(&particles)) { return; }
    var pi = particles[i]; let w1 = getInvMass(i); if (w1 <= 0.0) { return; }
    let velI = pi.pos - pi.prevPos; var newVel = velI;
    
    for (var j: u32 = 0u; j < 256u; j++) {
        if (i == j) { continue; }
        let pj = particles[j]; if (pj.mass <= 0.0) { continue; }
        let delta = pi.pos - pj.pos; let dist = length(delta); let minDist = pi.radius + pj.radius;
        if (dist < minDist + 0.005 && dist > 0.0001) {
            let n = delta / dist; let velJ = pj.pos - pj.prevPos;
            let relVel = newVel - velJ; let vn = dot(relVel, n); let vt = relVel - n * vn;
            if (length(vt) > 0.0001) {
                let frictionFactor = clamp(1.0 - (pi.friction + pj.friction), 0.0, 1.0);
                newVel = (n * vn + vt * max(0.0, frictionFactor * 0.5)) + velJ;
            }
        }
    }
    particles[i].prevPos = pi.pos - newVel;
}