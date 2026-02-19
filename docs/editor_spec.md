# Pajonk Level Editor Specification

## 1. UI Layout & Functional Areas

### 1.1 Top Menu
- **Level:** 
  - `Create New`: Clears ECS world and GPU buffers.
  - `Save`: Serializes ECS entities (filtered by 'persistent' tag) to JSON.
  - `Load`: Deserializes JSON and recreates entities/GPU buffers.
- **Mode:**
  - `Editor`: Physics paused (or selective spooling), gizmos active, selection enabled.
  - `Player`: Physics running, gizmos hidden, UI collapsed to minimal overlay.
- **View:** Toggles (Checkboxes) for visibility of side panels:
  - `Object List`, `Object Properties`, `Object Palette`.

### 1.2 Object List (Panel)
- Hierarchical or flat list of all active entities.
- **Filters:** [All, Static, Dynamic, Rope, Special].
- **Search:** Fuzzy search by entity name/ID.
- **Actions:** Hide/Show (eye icon), Lock (prevent selection), Delete.

### 1.3 Object Palette (Panel)
- List of "Blueprints" for drag-and-drop or click-to-place:
  - **Statics:** Box, Circle, Rounded Box.
  - **Dynamics:** Physics-active Circle, Box.
  - **Kinematics:** Plank (rigid bar), Heavy Ball, Bridge Segment.
  - **Special:** Player Start, Goal, Wind Source.

### 1.4 Object Properties (Panel)
- Context-aware editor based on current selection.
- **Common:** Position (X, Y), Name, Attachable (Boolean).
- **Geometry:** Width, Height, Radius, Rotation (Degrees/Radians).
- **Physics:** Mass, Friction, Elasticity (Restitution).
- **Visual:** Color (Hex/Picker), Texture, Opacity.

### 1.5 Toolbar
- **Simulation:** [Stop, Play, Step-Frame].
- **Tools:**
  - `Select`: Basic click/box selection.
  - `Move/Translate`: GRS Gizmo or direct drag.
  - `Rotate`: Rotation ring gizmo.
  - `Scale`: Axis-aligned scale gizmo (Static/Dynamic only).
  - `Build Line`: Manual/Auto rope spooling tool.

## 2. Object Type Definitions

| Type | Physics Logic | Transformations | Notes |
| :--- | :--- | :--- | :--- |
| **Static** | Analytical SDF in GPU `Obstacles` buffer. | Pos, Rotate, Scale | Used for level geometry/walls. |
| **Dynamic** | Particle-based (Single or Group). | Pos, Rotate, Scale | Basic physics shapes. |
| **Kinematic** | Predefined particle clusters + rigid constraints. | Pos, Rotate | Fixed internal structure (e.g. Planks). |
| **Rope** | Linked particle chain. | Control points | Spooled via tool or logic. |
| **Player** | Complex Kinematic (Pajonk Zyzio). | Pos, Input-driven | Specialized PBD logic for legs/sticking. |

## 3. Technical Implementation Details

### 3.1 Attachable Property
- A component `isAttachable` in ECS.
- When the Rope Tool is active, `findAnchor` performs an intersection test only against entities with this component.
- On GPU, this may be packed into a bitmask in the `Obstacle` or `Particle` struct.

### 3.2 Transform Matrices (SDF Objects)
- For rotated/scaled Statics, the GPU shader will receive an `inverseTransform` matrix.
- Collision check: `Point_Local = InverseTransform * Point_World`.
- The SDF calculation is then performed in local space, ensuring rotation and non-uniform scaling work perfectly.

### 3.3 Kinematic Groups
- Kinematics (like Planks) are instantiated as a set of particles.
- **Weld Constraints:** Maintain 0-distance and fixed relative angles between nodes.
- **Rotation:** Applying a rotation to a Kinematic object in the editor rotates the entire cluster's initial local coordinates before syncing to GPU.