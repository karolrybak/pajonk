# Trimesh Import Specification (v1.0)

Ten dokument definiuje format danych wejściowych dla narzędzia importu geometrii (vectorization -> delaunay -> trimesh).

## Format Pliku (JSON)

Każdy importowany obiekt powinien być reprezentowany jako obiekt JSON o następującej strukturze:

```json
{
  "version": "1.0",
  "metadata": {
    "name": "rock_formation_01",
    "source": "vectorizer_v2"
  },
  "mesh": {
    "vertices": [x0, y0, x1, y1, ...],  // Flat array of float32 coords
    "indices": [i0, i1, i2, ...],      // Triplets of vertex indices (triangles)
    "uvs": [u0, v0, u1, v1, ...],      // Normalized 0.0 - 1.0 texture coords
    "textureUrl": "path/to/asset.png"   // Optional texture reference
  },
  "physics": {
    "type": "static",                  // "static" | "dynamic" | "soft_body"
    "friction": 0.5,
    "collisionMask": 255
  }
}
```

## Definicje Pól

### mesh.vertices
Tablica typu `Float32`. Współrzędne lokalne obiektu. Środek ciężkości powinien znajdować się w punkcie `(0,0)`, aby transformacje (rotacja/skalowanie) działały poprawnie.

### mesh.indices
Tablica typu `Uint16` lub `Uint32`. Definiuje trójkąty. Silnik zakłada kolejność wierzchołków **CCW (Counter-Clockwise)** dla określenia frontu powierzchni.

### mesh.uvs
Mapowanie wierzchołków na przestrzeń tekstury. Rozmiar tej tablicy musi wynosić dokładnie `vertices.length` (1 wierzchołek UV na 1 wierzchołek pozycji).

## Implementacja w Silniku

Dla fizyki opartej na cząsteczkach (PBD), Trimesh może być traktowany na dwa sposoby:
1. **Static Obstacle:** Wierzchołki mesh-a definiują krawędzie dla raycastingu i kolizji SDF.
2. **Soft Body:** Każdy unikalny wierzchołek staje się `physicsParticle`, a krawędzie trójkątów stają się `physicsConstraint` typu Distance.
