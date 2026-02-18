# Web-Builder 2D Requirements

## Functional Requirements
- **Spider Movement (Wall/Ceiling):**
  - Smooth movement along the 2D boundaries (Left, Right, Up, Down).
  - Spider should automatically stick to walls/ceiling when touching them.
- **Jump Mechanic:**
  - Pressing Space detaches the spider from the wall.
  - Initial velocity applied in the direction of the jump.
- **Web Creation (Rope):**
  - A line starts from the point where the spider jumped.
  - The line follows the spider in the air.
  - Rope length can be adjusted (Up/Down keys while in air).
- **Pinning:**
  - Pressing 'E' or touching another wall while in air attaches the current line permanently.
- **Environment:**
  - 2D rectangular box as boundaries.
  - Constant gravity and a variable wind vector.

## Technical Requirements
- **Renderer:** Three.js using `WebGPURenderer`.
- **Physics Engine:** Custom Compute Shader based on Position Based Dynamics (PBD).
- **State Management:** Simple state machine for the spider (IDLE, CLIMBING, IN_AIR).
- **Performance:** Target 60 FPS with thousands of rope segments using GPU buffers.