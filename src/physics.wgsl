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
    c: i32,
    cType: u32,
    rest: f32,
    comp: f32,
    ex0: f32,
    ex1: f32
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
    
    let p0 = P[c.a];
    let w0 = select(0.0, 1.0/p0.mass, p0.mass > 0.0);
    
    var p1 = p0;
    var w1 = 0.0;
    if (c.cType == 3u) {
        p1.pos = vec2<f32>(c.ex0, c.ex1);
    } else if (c.b >= 0) {
        p1 = P[u32(c.b)];
        w1 = select(0.0, 1.0/p1.mass, p1.mass > 0.0);
    }
    
    var p2 = p0;
    var w2 = 0.0;
    if (c.c >= 0) {
        p2 = P[u32(c.c)];
        w2 = select(0.0, 1.0/p2.mass, p2.mass > 0.0);
    }

    let sdt = par.dt / f32(par.substeps);
    let alpha = c.comp / (sdt * sdt);

    // 0: Distance, 3: Anchor, 4: Inequality
    if (c.cType == 0u || c.cType == 3u || c.cType == 4u) {
        let wSum = w0 + w1;
        if (wSum == 0.0) { return; }
        let dir = p0.pos - p1.pos;
        let dist = length(dir);
        if (dist == 0.0) { return; }
        if (c.cType == 4u && dist >= c.rest) { return; }
        
        let n = dir / dist;
        let err = dist - c.rest;
        let lambda = -err / (wSum + alpha);
        
        if (w0 > 0.0) { P[c.a].pos += n * (lambda * w0); }
        if (c.b >= 0 && w1 > 0.0) { P[u32(c.b)].pos -= n * (lambda * w1); }
    }
    // 1: Angular (a=end1, b=hinge, c=end2)
    else if (c.cType == 1u) {
        let v0 = p0.pos - p1.pos;
        let v2 = p2.pos - p1.pos;
        let l0_sq = dot(v0, v0);
        let l2_sq = dot(v2, v2);
        if (l0_sq < 0.0001 || l2_sq < 0.0001) { return; }
        
        let current_angle = atan2(v0.x * v2.y - v0.y * v2.x, dot(v0, v2));
        var err = current_angle - c.rest;
        while(err > 3.14159) { err -= 6.28318; }
        while(err < -3.14159) { err += 6.28318; }
        
        let g0 = vec2<f32>(-v0.y / l0_sq, v0.x / l0_sq);
        let g2 = vec2<f32>(v2.y / l2_sq, -v2.x / l2_sq);
        let g1 = -(g0 + g2);
        
        let sum_w_grad2 = w0 * dot(g0, g0) + w1 * dot(g1, g1) + w2 * dot(g2, g2);
        if (sum_w_grad2 < 0.00001) { return; }
        
        let lambda = -err / (sum_w_grad2 + alpha);
        if (w0 > 0.0) { P[c.a].pos += g0 * (lambda * w0); }
        if (w1 > 0.0) { P[u32(c.b)].pos += g1 * (lambda * w1); }
        if (w2 > 0.0) { P[u32(c.c)].pos += g2 * (lambda * w2); }
    }
    // 2: Area (a, b, c)
    else if (c.cType == 2u) {
        let g0 = vec2<f32>(p1.pos.y - p2.pos.y, p2.pos.x - p1.pos.x) * 0.5;
        let g1 = vec2<f32>(p2.pos.y - p0.pos.y, p0.pos.x - p2.pos.x) * 0.5;
        let g2 = vec2<f32>(p0.pos.y - p1.pos.y, p1.pos.x - p0.pos.x) * 0.5;
        
        let current_area = 0.5 * ((p1.pos.x - p0.pos.x) * (p2.pos.y - p0.pos.y) - (p1.pos.y - p0.pos.y) * (p2.pos.x - p0.pos.x));
        let err = current_area - c.rest;
        
        let sum_w_grad2 = w0 * dot(g0, g0) + w1 * dot(g1, g1) + w2 * dot(g2, g2);
        if (sum_w_grad2 < 0.00001) { return; }
        
        let lambda = -err / (sum_w_grad2 + alpha);
        if (w0 > 0.0) { P[c.a].pos += g0 * (lambda * w0); }
        if (w1 > 0.0) { P[u32(c.b)].pos += g1 * (lambda * w1); }
        if (w2 > 0.0) { P[u32(c.c)].pos += g2 * (lambda * w2); }
    }
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
