struct Particle {
    position: vec2<f32>,
    old_position: vec2<f32>,
    mass: f32,
    padding: f32,
};

struct Constraint {
    nodeA: u32,
    nodeB: u32,
    restLength: f32,
    stiffness: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> constraints: array<Constraint>;

// SDF Functions for GPU-side collisions
fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
    return length(p) - r;
}

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    if (index >= arrayLength(&particles)) { return; }
    
    var p = particles[index];
    if (p.mass <= 0.0) { return; }

    // Integration and simple SDF collision logic will expand here
    let vel = p.position - p.old_position;
    p.old_position = p.position;
    p.position = p.position + vel + vec2<f32>(0.0, -0.005); // Gravity
    
    particles[index] = p;
}