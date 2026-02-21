struct Params {
    dt: f32,
    substeps: u32,
    gravity: vec2<f32>,
    bounds: vec4<f32>,
    colIters: u32,
    numObstacles: u32,
    pad2: u32,
    pad3: u32
}

struct Particle {
    pos: vec2<f32>,
    prev: vec2<f32>,
    mass: f32,
    friction: f32,
    radius: f32,
    mask: u32
}

struct Constraint {
    a: u32,
    b: i32,
    len: f32,
    comp: f32,
    anchor: vec2<f32>,
    cType: u32,
    pad: u32
}

struct Obstacle {
    pos: vec2<f32>,
    rot: f32,
    shape: u32,
    p: array<f32, 5>,
    friction: f32,
    pad: array<f32, 6>
}

@group(0) @binding(0) var<storage, read_write> P: array<Particle>;
@group(0) @binding(1) var<storage, read> C: array<Constraint>;
@group(0) @binding(2) var<storage, read> O: array<Obstacle>;
@group(0) @binding(3) var<uniform> par: Params;

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= 16384u) { return; }
    
    var p = P[i];
    if (p.mass <= 0.0 || p.mask == 0u) { return; }
    
    let v = (p.pos - p.prev) * 0.999; // Velocity damping
    
    p.prev = p.pos;
    p.pos += v + par.gravity * par.dt * par.dt;
    P[i] = p;
}

@compute @workgroup_size(64)
fn solveConstraints(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= 16384u) { return; }
    
    let c = C[i];
    if (c.len == 0.0 && c.cType == 0u) { return; }
    
    var pA = P[c.a];
    var pB: Particle;
    var wA = select(0.0, 1.0/pA.mass, pA.mass > 0.0);
    var wB = 0.0;
    var posB = c.anchor;
    
    if (c.b >= 0) {
        pB = P[u32(c.b)];
        wB = select(0.0, 1.0/pB.mass, pB.mass > 0.0);
        posB = pB.pos;
    }
    
    let wSum = wA + wB;
    if (wSum == 0.0) { return; }
    
    let dir = pA.pos - posB;
    let dist = length(dir);
    if (dist == 0.0) { return; }
    
    let n = dir / dist;
    let err = dist - c.len;
    let sdt = par.dt / f32(par.substeps);
    let alpha = c.comp / (sdt * sdt);
    let lambda = -err / (wSum + alpha);
    
    if (wA > 0.0) { P[c.a].pos += n * (lambda * wA); }
    if (c.b >= 0 && wB > 0.0) { P[u32(c.b)].pos -= n * (lambda * wB); }
}

fn sdObstacle(obs: Obstacle, p: vec2<f32>) -> f32 {
    let s = sin(-obs.rot);
    let c = cos(-obs.rot);
    let dx = p.x - obs.pos.x;
    let dy = p.y - obs.pos.y;
    let lp = vec2<f32>(dx * c - dy * s, dx * s + dy * c);
    
    if (obs.shape == 0u) {
        return length(lp) - obs.p[0];
    } else if (obs.shape == 1u) {
        let q = abs(lp) - vec2<f32>(obs.p[0], obs.p[1]);
        return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0);
    }
    return 1000.0;
}

@compute @workgroup_size(64)
fn solveCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= 16384u) { return; }
    
    var p = P[i];
    if (p.mass <= 0.0 || p.mask == 0u) { return; }
    
    let pad = p.radius;
    if (p.pos.x < par.bounds.x + pad) { p.pos.x = par.bounds.x + pad; }
    if (p.pos.x > par.bounds.z - pad) { p.pos.x = par.bounds.z - pad; }
    if (p.pos.y < par.bounds.y + pad) { p.pos.y = par.bounds.y + pad; }
    if (p.pos.y > par.bounds.w - pad) { p.pos.y = par.bounds.w - pad; }

    for (var j = 0u; j < par.numObstacles; j++) {
        let obs = O[j];
        if (obs.shape > 10u) { continue; }
        
        let d = sdObstacle(obs, p.pos);
        if (d < p.radius) {
            let eps = 0.01;
            let dx = sdObstacle(obs, p.pos + vec2<f32>(eps, 0.0)) - sdObstacle(obs, p.pos - vec2<f32>(eps, 0.0));
            let dy = sdObstacle(obs, p.pos + vec2<f32>(0.0, eps)) - sdObstacle(obs, p.pos - vec2<f32>(0.0, eps));
            var n = vec2<f32>(dx, dy);
            let l = length(n);
            if (l > 0.0) {
                n = n / l;
                p.pos += n * (p.radius - d);
                let v = p.pos - p.prev;
                let vT = v - dot(v, n) * n;
                p.prev += vT * max(obs.friction, p.friction);
            }
        }
    }
    P[i] = p;
}
