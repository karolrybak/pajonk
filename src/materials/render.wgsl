struct Particle {
    pos: vec2<f32>,
    prevPos: vec2<f32>,
    mass: f32,
    friction: f32,
    radius: f32,
    object_data: u32,
};

struct Obstacle {
    pos: vec2<f32>,
    rotation: f32,
    object_data: u32,
    params: vec4<f32>,
};

struct Constraint {
    idxA: i32,
    idxB: i32,
    idxC: i32,
    cType: u32,
    restValue: f32,
    compliance: f32,
    extra: vec2<f32>,
};

struct Gizmo {
    pos: vec2<f32>,
    padding: vec2<f32>,
    color: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> obstacles: array<Obstacle>;
@group(0) @binding(2) var<uniform> viewProj: mat4x4<f32>;
@group(0) @binding(3) var<storage, read> constraints: array<Constraint>;
@group(0) @binding(4) var<uniform> gizmo: Gizmo;

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) instanceIdx: u32,
    @location(2) @interpolate(flat) typeIdx: u32,
};

@vertex
fn vs(@builtin(vertex_index) vertexIdx: u32, @builtin(instance_index) instanceIdx: u32) -> VertexOutput {
    var out: VertexOutput;
    let quad = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
    );
    
    let uv = quad[vertexIdx];
    out.uv = uv;
    out.instanceIdx = instanceIdx;
    
    var worldPos: vec2<f32>;
    var scale: vec2<f32> = vec2<f32>(1.0);
    
    if (instanceIdx < 1024u) { 
        let obs = obstacles[instanceIdx];
        let shape = obs.object_data & 0xFFu;
        scale = vec2<f32>(obs.params.x, obs.params.y);
        if (shape == 0u) { scale = vec2<f32>(obs.params.x); }
        
        let c = cos(obs.rotation);
        let s = sin(obs.rotation);
        let localPos = uv * (scale + 0.1);
        worldPos = vec2<f32>(localPos.x * c - localPos.y * s, localPos.x * s + localPos.y * c) + obs.pos;
        out.typeIdx = 0u;
    } else {
        let pIdx = instanceIdx - 1024u;
        let p = particles[pIdx];
        scale = vec2<f32>(p.radius + 0.1);
        worldPos = p.pos + uv * scale;
        out.typeIdx = 1u;
    }

    out.pos = viewProj * vec4<f32>(worldPos, 0.0, 1.0);
    return out;
}

@vertex
fn vs_lines(@builtin(vertex_index) vertexIdx: u32, @builtin(instance_index) instanceIdx: u32) -> @builtin(position) vec4<f32> {
    let c = constraints[instanceIdx];
    if (c.idxA < 0) { return vec4<f32>(-100.0, -100.0, -100.0, 1.0); }
    
    let pA = particles[u32(c.idxA)].pos;
    var pB: vec2<f32>;
    if (c.idxB >= 0) {
        pB = particles[u32(c.idxB)].pos;
    } else {
        pB = c.extra;
    }
    
    let worldPos = select(pA, pB, vertexIdx == 1u);
    return viewProj * vec4<f32>(worldPos, 0.0, 1.0);
}

@vertex
fn vs_gizmo(@builtin(vertex_index) vertexIdx: u32) -> VertexOutput {
    var out: VertexOutput;
    let quad = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
    );
    let uv = quad[vertexIdx];
    out.uv = uv;
    let worldPos = gizmo.pos + uv * 0.15;
    out.pos = viewProj * vec4<f32>(worldPos, 0.0, 1.0);
    return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    var d = 1000.0;
    var color = vec3<f32>(0.5);
    var alpha = 0.0;
    var data_val: u32;
    var radius_val: f32 = 1.0;

    if (in.typeIdx == 0u) {
        let obs = obstacles[in.instanceIdx];
        let shape = obs.object_data & 0xFFu;
        data_val = obs.object_data;
        if (shape == 0u) {
            d = length(in.uv * (obs.params.x + 0.1)) - obs.params.x;
            radius_val = obs.params.x;
        } else if (shape == 1u) {
            let q = abs(in.uv * (obs.params.xy + 0.1)) - obs.params.xy * 0.5;
            d = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0);
            radius_val = min(obs.params.x, obs.params.y);
        } else if (shape == 2u) {
            let q = abs(in.uv * (obs.params.xy + 0.1)) - obs.params.xy * 0.5;
            d = -(length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0));
            radius_val = min(obs.params.x, obs.params.y);
        }
    } else {
        let pIdx = in.instanceIdx - 1024u;
        let p = particles[pIdx];
        data_val = p.object_data;
        radius_val = p.radius;
        d = length(in.uv * (p.radius + 0.1)) - p.radius;
    }

    let appearance = (data_val >> 8u) & 0xFFu;
    let flags = (data_val >> 16u) & 0xFFu;

    if (appearance == 1u) { color = vec3<f32>(0.2, 0.2, 0.2); }
    else if (appearance == 2u) { color = vec3<f32>(0.0, 1.0, 0.5); }
    else if (appearance == 3u) { color = vec3<f32>(0.5, 0.3, 0.1); }
    else if (appearance == 7u) { color = vec3<f32>(0.2, 0.25, 0.3); }
    else if (appearance == 6u) { 
        color = vec3<f32>(1.0, 1.0, 1.0);
        alpha = smoothstep(0.01, -0.01, d) * 0.4; 
    }
    
    if (appearance != 6u) {
        alpha = smoothstep(0.01, -0.01, d);
    }

    if ((flags & 1u) != 0u) {
        let thickness = 0.02;
        let border = smoothstep(thickness, 0.0, abs(d + thickness * 0.5));
        color = mix(color, vec3<f32>(1.0, 1.0, 0.0), border);
        alpha = max(alpha, border);
    }

    return vec4<f32>(color, alpha);
}

@fragment
fn fs_lines() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 1.0, 1.0, 0.8);
}

@fragment
fn fs_gizmo(in: VertexOutput) -> @location(0) vec4<f32> {
    let d = length(in.uv) - 0.8;
    let alpha = smoothstep(0.1, -0.1, abs(d) - 0.1);
    return vec4<f32>(gizmo.color.rgb, alpha * gizmo.color.a);
}