# Specyfikacja API i Architektury ECS (v4 - Final Design)

## 1. WebPhysics API (Backend)

### Zarządzanie Cząsteczkami (ParticleData Layout: 32 bytes / 8 floats):
- `f32[0,1]: pos`, `f32[2,3]: prevPos`, `f32[4]: mass`, `f32[5]: friction`, `f32[6]: radius`, `u32[7]: collisionMask`.

### Zarządzanie Więzami (ConstraintData Layout: 32 bytes / 8 floats):
- `u32[0]: indexA`, `i32[1]: indexB` (Jeśli < 0 -> World Anchor).
- `f32[2]: length`, `f32[3]: compliance`.
- `f32[4,5]: worldAnchorPos`.
- `u32[6]: type`, `u32[7]: padding`.

### Statyczne Przeszkody (ObstacleData Layout: 64 bytes / 16 floats):
- `f32[0,1]: pos`, `f32[2]: rotation`, `u32[3]: shapeType` (Circle=0, Box=1, RoundedBox=2, etc.).
- `f32[4,5,6,7,8]: parameters` (Np. size.x, size.y, r1, r2, h).
- `f32[9]: friction`.
- `f32[10-15]: reserved/padding`.

### Zapytania Przestrzenne (Z maską bitową):
- `findNearest(pos, radius, mask)`, `queryRadius(pos, radius, mask)`, `raycast(origin, dir, maxDist, mask)`.

### Parametry Symulacji (Uniform Buffer):
- `dt` (Fixed), `substeps`, `gravity`, `worldBounds`, `collisionIterations`.

---

## 2. ECS: Komponenty

### PhysicsBody
- `isStatic: boolean`, `mass: number`, `friction: number`, `collisionMask: number`, `groupId: number`.

### SDFCollider (Tylko dla statycznych)
- `shapeType: number` (ID kształtu dla shadera).
- `parameters: [number, number, number, number, number]` (Surowe dane SDF).
- `rotation: number`.

### PhysicsParticle
- `index: number` (Link do GPU).

### PhysicsConstraint
- `targetA: Entity`, `targetB: Entity | Vector2`, `length: number`, `stiffness: number`.

### PhysicsRope
- `headAnchor: { target: Entity | Vector2, offset: Vector2 }`.
- `tailAnchor: { target: Entity | Vector2, offset: Vector2 }`.
- `segments: Entity[]`, `segmentLength: number`, `compliance: number`.

### Transform
- `position: Vector2`, `rotation: number` (Główny stan encji).

---

## 3. Cykl Życia Systemów

1. **Fixed Step Loop** (1/60s):
   - **InputSystem**: Zmiana `Velocity` / `Transform` gracza.
   - **RopeSystem**: Zarządzanie segmentami (Reeling).
   - **PhysicsSyncSystem**: 
     - Przypisuje nowe cząsteczki/więzy/przeszkody do wolnych slotów GPU.
     - Aktualizuje bufory GPU na podstawie komponentów ECS.
   - **WebPhysics.step()**: Obliczenia GPU.
   - **PhysicsUpdateSystem**: Pobiera pozycje z GPU -> ECS Transform.
2. **VisualSyncSystem**: ECS Transform -> Three.js Mesh.
3. **Render**.
