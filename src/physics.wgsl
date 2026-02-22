/* 
 * GPU Physics Kernel
 * Implements Position Based Dynamics (PBD) with Spatial Hashing
 */

struct Particle {
    pos: vec2<f32>,
    prevPos: vec2<f32>,
    mass: f32,
    friction: f32,
    radius: f32,
    object_data: u32, // Bitmask: [0-7] Mask, [8-15] Appearance, [16-23] Flags
};

struct Constraint {
    idxA: i32,
    idxB: i32,
    color: i32,    // Graph coloring for parallel solving
    cType: u32,    // 0: Distance, 1: Bending, 3: Anchor
    restValue: f32,
    compliance: f32,
    extra: vec2<f32>, // Usually world anchor position
};

struct Obstacle {
    pos: vec2<f32>,
    rotation: f32,
    object_data: u32,
    params: vec4<f32>, // Circle: [r, 0, 0, 0], Box: [w, h, 0, 0]
};

struct Params {
    dt: f32,
    substeps: u32,
    gravity: vec2<f32>,
    worldBounds: vec4<f32>,
    collisionIterations: u32,
    numObstacles: u32,
    isPaused: u32,
    phase: u32,      // Current constraint color phase
    numCommands: u32,
    pad0: u32,
    pad1: u32,
    numQueries: u32,
};

struct Command {
    cmdType: u32,   // 1: Add, 2: Move, 3: Constraint, 4: RemParticle, 5: RemConstraint, 6: SetObstacle
    index: u32,     // Buffer index to modify
    pad0: u32,
    pad1: u32,
    d0: vec4<f32>,
    d1: vec4<f32>,
};

struct Query {
    qType: u32,     // 1: Nearest, 2: Radius, 3: Raycast, 4: Ping
    mask: u32,
    pad0: u32,
    pad1: u32,
    origin: vec2<f32>,
    dir_or_radius: vec2<f32>,
    maxDist: f32,
    pad2: f32,
    pad3: f32,
    pad4: f32,
};

struct QueryResult {
    count: u32,
    hitType: u32,   // 1: Particle, 2: Obstacle, 4: Ping
    hitIdx: i32,
    distance: f32,
    hitPos: vec2<f32>,
    hitNormal: vec2<f32>,
    hits: array<i32, 16>,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> constraints: array<Constraint>;
@group(0) @binding(2) var<storage, read_write> obstacles: array<Obstacle>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> commands: array<Command>;
@group(0) @binding(5) var<storage, read_write> grid: array<atomic<i32>>; // Cell -> Particle Index
@group(0) @binding(6) var<storage, read_write> next_node: array<i32>;   // Linked list pointers
@group(0) @binding(7) var<storage, read> queries: array<Query>;
@group(0) @binding(8) var<storage, read_write> queryResults: array<QueryResult>;

fn rotate(v: vec2<f32>, angle: f32) -> vec2<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);
}

// Returns vec3(dist, normal.x, normal.y)
fn sdBoxInfo(p: vec2<f32>, b: vec2<f32>) -> vec3<f32> {
    let d = abs(p) - b;
    let dist = length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
    
    var n: vec2<f32>;
    if (d.x > 0.0 && d.y > 0.0) {
        n = normalize(vec2<f32>(sign(p.x) * d.x, sign(p.y) * d.y));
    } else if (d.x > d.y) {
        n = vec2<f32>(sign(p.x), 0.0);
    } else {
        n = vec2<f32>(0.0, sign(p.y));
    }
    return vec3<f32>(dist, n.x, n.y);
}

fn getSDFInfo(p: vec2<f32>, obs: Obstacle) -> vec3<f32> {
    let localP = rotate(p - obs.pos, -obs.rotation);
    let type_id = obs.object_data & 0xFFu;
    let appearance = (obs.object_data >> 8u) & 0xFFu;

    var info = vec3<f32>(1000.0, 0.0, 1.0);

    if (appearance == 7u) {
        info = sdBoxInfo(localP, obs.params.xy * 0.5);
        info.x = -info.x; // World border is inverted box
        info.y = -info.y; info.z = -info.z;
    } else if (type_id == 0u) {
        let dist = length(localP) - obs.params.x;
        let n = select(normalize(localP), vec2<f32>(0.0, 1.0), dist < 0.0001 && length(localP) < 0.0001);
        info = vec3<f32>(dist, n.x, n.y);
    } else if (type_id == 1u) {
        info = sdBoxInfo(localP, obs.params.xy * 0.5);
    }

    let worldN = rotate(info.yz, obs.rotation);
    return vec3<f32>(info.x, worldN.x, worldN.y);
}

fn getInvMass(i: u32) -> f32 {
    let p = particles[i];
    let flags = (p.object_data >> 16u) & 0xFFu;
    let simAlways = (flags & 2u) != 0u;
    // If paused, only 'simAlways' (e.g. building rope) particles move
    if (params.isPaused == 1u && !simAlways) { return 0.0; }
    if (p.mass <= 0.0) { return 0.0; }
    return 1.0 / p.mass;
}

// Converts world position to 1D grid cell index
fn getCellID(pos: vec2<f32>) -> i32 {
    let cellSize = 0.5;
    let gridW = 64i;
    let gridH = 64i;
    // Offset by 16.0 to handle negative coordinates (world is roughly [-12, 12])
    let x = i32(floor((pos.x + 16.0) / cellSize));
    let y = i32(floor((pos.y + 16.0) / cellSize));
    if (x < 0 || x >= gridW || y < 0 || y >= gridH) { return -1; }
    return x + y * gridW;
}

fn getCellIDClamp(pos: vec2<f32>) -> vec2<i32> {
    let cellSize = 0.5;
    let gridW = 64i;
    let gridH = 64i;
    let x = clamp(i32(floor((pos.x + 16.0) / cellSize)), 0, gridW - 1);
    let y = clamp(i32(floor((pos.y + 16.0) / cellSize)), 0, gridH - 1);
    return vec2<i32>(x, y);
}

@compute @workgroup_size(64)
fn processCommands(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numCommands) { return; }
    let cmd = commands[i];
    
    if (cmd.cmdType == 1u) { // Add/Setup Particle
        particles[cmd.index].pos = cmd.d0.xy;
        particles[cmd.index].prevPos = cmd.d0.zw;
        particles[cmd.index].mass = cmd.d1.x;
        particles[cmd.index].friction = cmd.d1.y;
        particles[cmd.index].radius = cmd.d1.z;
        particles[cmd.index].object_data = bitcast<u32>(cmd.d1.w);
    } else if (cmd.cmdType == 2u) { // Move Particle Directly (Drag)
        particles[cmd.index].pos = cmd.d0.xy;
        particles[cmd.index].prevPos = cmd.d0.zw;
    } else if (cmd.cmdType == 3u) { // Create/Update Constraint
        constraints[cmd.index].idxA = i32(cmd.d0.x);
        constraints[cmd.index].idxB = i32(cmd.d0.y);
        constraints[cmd.index].color = i32(cmd.d0.z);
        constraints[cmd.index].cType = u32(cmd.d0.w);
        constraints[cmd.index].restValue = cmd.d1.x;
        constraints[cmd.index].compliance = cmd.d1.y;
        constraints[cmd.index].extra = cmd.d1.zw;
    } else if (cmd.cmdType == 4u) { // Kill Particle
        particles[cmd.index].mass = 0.0;
        particles[cmd.index].object_data = 0u;
        particles[cmd.index].radius = 0.0;
    } else if (cmd.cmdType == 5u) { // Kill Constraint
        constraints[cmd.index].idxA = -1;
    } else if (cmd.cmdType == 6u) { // Set/Modify Static Obstacle
        obstacles[cmd.index].pos = cmd.d0.xy;
        obstacles[cmd.index].rotation = cmd.d0.z;
        obstacles[cmd.index].object_data = bitcast<u32>(cmd.d0.w);
        obstacles[cmd.index].params = cmd.d1;
    }
}

@compute @workgroup_size(64)
fn clearGrid(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i < 4096u) {
        atomicStore(&grid[i], -1);
    }
}

@compute @workgroup_size(64)
fn buildGrid(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= arrayLength(&particles)) { return; }
    let p = particles[i];
    if (p.mass <= 0.0) { 
        next_node[i] = -1;
        return; 
    }
    
    let cell = getCellID(p.pos);
    if (cell >= 0) {
        // Atomically swap the head of the list for this cell
        let old = atomicExchange(&grid[cell], i32(i));
        next_node[i] = old;
    } else {
        next_node[i] = -1;
    }
}

@compute @workgroup_size(64)
fn processQueries(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.numQueries) { return; }
    
    let q = queries[i];
    var res: QueryResult;
    res.count = 0u;
    res.hitType = 0u;
    res.hitIdx = -1;
    res.distance = 100000.0;
    
    if (q.qType == 1u || q.qType == 2u) { // Search Nearby
        let radius = q.dir_or_radius.x;
        var bestDistSq = radius * radius;
        var bestIdx = -1;
        
        let minC = getCellIDClamp(q.origin - vec2<f32>(radius, radius));
        let maxC = getCellIDClamp(q.origin + vec2<f32>(radius, radius));
        
        for (var cy = minC.y; cy <= maxC.y; cy++) {
            for (var cx = minC.x; cx <= maxC.x; cx++) {
                let cell = cx + cy * 64i;
                var curr = atomicLoad(&grid[cell]);
                var iters = 0u;
                while (curr >= 0 && iters < 256u) {
                    let pIdx = u32(curr);
                    curr = next_node[pIdx];
                    iters++;
                    
                    let p = particles[pIdx];
                    if ((p.object_data & q.mask) == 0u) { continue; }
                    
                    let delta = p.pos - q.origin;
                    let distSq = dot(delta, delta);
                    
                    if (distSq <= bestDistSq) {
                        if (q.qType == 1u) {
                            bestDistSq = distSq;
                            bestIdx = i32(pIdx);
                        } else if (q.qType == 2u) {
                            if (res.count < 16u) {
                                res.hits[res.count] = i32(pIdx);
                                res.count++;
                            }
                        }
                    }
                }
            }
        }
        
        if (q.qType == 1u && bestIdx != -1) {
            res.hitType = 1u;
            res.hitIdx = bestIdx;
            res.distance = sqrt(bestDistSq);
            res.hitPos = particles[bestIdx].pos;
        }
    } else if (q.qType == 3u) { // Raycast
        var bestT = q.maxDist;
        var bestHitType = 0u;
        var bestHitIdx = -1;
        var bestHitNorm = vec2<f32>(0.0);
        
        // Ray-Particle traversal
        let rayMin = min(q.origin, q.origin + q.dir_or_radius * q.maxDist);
        let rayMax = max(q.origin, q.origin + q.dir_or_radius * q.maxDist);
        let minC = getCellIDClamp(rayMin - vec2<f32>(0.5));
        let maxC = getCellIDClamp(rayMax + vec2<f32>(0.5));
        
        for (var cy = minC.y; cy <= maxC.y; cy++) {
            for (var cx = minC.x; cx <= maxC.x; cx++) {
                let cell = cx + cy * 64i;
                var curr = atomicLoad(&grid[cell]);
                var iters = 0u;
                while (curr >= 0 && iters < 256u) {
                    let pIdx = u32(curr);
                    curr = next_node[pIdx];
                    iters++;
                    
                    let p = particles[pIdx];
                    if ((p.object_data & q.mask) == 0u) { continue; }
                    
                    let oc = q.origin - p.pos;
                    let b = dot(oc, q.dir_or_radius);
                    let c = dot(oc, oc) - p.radius * p.radius;
                    let h = b*b - c;
                    if (h > 0.0) {
                        let t = -b - sqrt(h);
                        if (t > 0.0 && t < bestT) {
                            bestT = t;
                            bestHitType = 1u;
                            bestHitIdx = i32(pIdx);
                            bestHitNorm = normalize((q.origin + q.dir_or_radius * t) - p.pos);
                        }
                    }
                }
            }
        }
        
        // Ray-Obstacle traversal (Simple Marching)
        var tObs = 0.0;
        for(var step=0; step<50; step++) {
            let pPos = q.origin + q.dir_or_radius * tObs;
            if (tObs > bestT) { break; }
            
            var d = 1000.0;
            var hIdx = -1;
            var hNorm = vec2<f32>(0.0);
            for(var j=0u; j<params.numObstacles; j++) {
                 let info = getSDFInfo(pPos, obstacles[j]);
                 if (info.x < d) { d = info.x; hIdx = i32(j); hNorm = info.yz; }
            }
            if (d < 0.001) {
                 bestT = tObs;
                 bestHitType = 2u;
                 bestHitIdx = hIdx;
                 bestHitNorm = hNorm;
                 break;
            }
            tObs += max(d, 0.01);
        }
        
        if (bestHitType != 0u) {
            res.hitType = bestHitType;
            res.hitIdx = bestHitIdx;
            res.distance = bestT;
            res.hitPos = q.origin + q.dir_or_radius * bestT;
            res.hitNormal = bestHitNorm;
        }
    } else if (q.qType == 4u) { // Ping
        res.hitType = 4u;
        res.hitIdx = i32(q.mask);
        res.count = 1u;
    }
    
    queryResults[i] = res;
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
    let vel = (particles[i].pos - particles[i].prevPos) * 0.99; // Simple damping
    particles[i].pos += vel + params.gravity * params.dt * params.dt;
    particles[i].prevPos = temp;
}

@compute @workgroup_size(64)
fn solveConstraints(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= arrayLength(&constraints)) { return; }
    let c = constraints[i]; 
    // Skip if invalid or if it's not the current solve phase (coloring)
    if (c.idxA < 0 || u32(c.color) != params.phase) { return; }
    
    let w1 = getInvMass(u32(c.idxA));
    var w2 = 0.0;
    var pB: vec2<f32>;
    
    if (c.idxB >= 0) {
        w2 = getInvMass(u32(c.idxB));
        pB = particles[u32(c.idxB)].pos;
    } else {
        pB = c.extra; // World space anchor
    }
    
    let wSum = w1 + w2; if (wSum <= 0.0) { return; }
    let delta = particles[u32(c.idxA)].pos - pB;
    let dist = length(delta); if (dist < 0.0001) { return; }
    
    // PBD Constraint Solver with Compliance
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
        let info = getSDFInfo(p.pos, obs);
        if (info.x < p.radius) {
            let n = info.yz;
            p.pos += n * (p.radius - info.x);
        }
    }
    particles[i].pos = p.pos;
}

@compute @workgroup_size(64)
fn solveParticleCollisions(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; 
    if (i >= arrayLength(&particles)) { return; }
    var pi = particles[i]; 
    let w1 = getInvMass(i);
    if (w1 <= 0.0) { return; }

    let maskI = pi.object_data & 0xFFu;
    let cell = getCellID(pi.pos);
    if (cell < 0) { return; }
    let gridW = 64i;
    
    // Search 3x3 neighbor cells
    for (var cy = -1; cy <= 1; cy++) {
        for (var cx = -1; cx <= 1; cx++) {
            let ncell = cell + cx + cy * gridW;
            if (ncell >= 0 && ncell < 4096i) {
                var curr = atomicLoad(&grid[ncell]);
                var iters = 0u;
                while (curr >= 0 && iters < 256u) {
                    let j = u32(curr);
                    curr = next_node[j];
                    iters++;
                    
                    if (i == j) { continue; }
                    let pj = particles[j]; 
                    if (pj.mass <= 0.0) { continue; }
                    
                    // Mask check for collision layers
                    if ((maskI & (pj.object_data & 0xFFu)) == 0u) { continue; }
                    
                    let delta = pi.pos - pj.pos; 
                    let dist = length(delta); 
                    let minDist = pi.radius + pj.radius;
                    if (dist < minDist && dist > 0.0001) {
                        let w2 = getInvMass(j); 
                        let wSum = w1 + w2;
                        if (wSum > 0.0) { 
                            let n = delta / dist; 
                            pi.pos += n * (minDist - dist) * (w1 / wSum);
                        }
                    }
                }
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
        let info = getSDFInfo(p.pos, obs);
        if (info.x < p.radius + 0.005) {
            let n = info.yz;
            let vn = dot(vel, n); let vt = vel - n * vn; let vtLen = length(vt);
            if (vtLen > 0.0001) {
                let obsFric = f32((obs.object_data >> 24u) & 0xFFu) / 255.0;
                newPrev = p.pos - (n * vn + vt * max(0.0, 1.0 - (obsFric + p.friction) * 0.5));
            }
        }
    }
    particles[i].prevPos = newPrev;
}

@compute @workgroup_size(64)
fn applyParticleFriction(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x; if (i >= arrayLength(&particles)) { return; }
    var pi = particles[i]; let w1 = getInvMass(i); if (w1 <= 0.0) { return; }
    let maskI = pi.object_data & 0xFFu;
    let velI = pi.pos - pi.prevPos; var newVel = velI;
    
    let cell = getCellID(pi.pos);
    if (cell < 0) { return; }
    let gridW = 64i;
    
    for (var cy = -1; cy <= 1; cy++) {
        for (var cx = -1; cx <= 1; cx++) {
            let ncell = cell + cx + cy * gridW;
            if (ncell >= 0 && ncell < 4096i) {
                var curr = atomicLoad(&grid[ncell]);
                var iters = 0u;
                while (curr >= 0 && iters < 256u) {
                    let j = u32(curr);
                    curr = next_node[j];
                    iters++;
                    
                    if (i == j) { continue; }
                    let pj = particles[j]; if (pj.mass <= 0.0) { continue; }
                    if ((maskI & (pj.object_data & 0xFFu)) == 0u) { continue; }
                    
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
            }
        }
    }
    particles[i].prevPos = pi.pos - newVel;
}
