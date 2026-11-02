# PocketMesh shared data format

PocketMesh is a mobile (iPhone Safari) polygon modeler, Blender-like. The app is
written as plain ES modules in `src/`; a build step concatenates them into one
inline `<script type="module">`, so **modules in `src/` must not import each
other or anything else** (no `import` lines). Use `export function` / `export const`
for the public API (the build strips the `export` keyword). Avoid top-level name
clashes: prefix private helpers in a file with a short tag (e.g. `_uv`, `_ex`).

## Coordinate system
Right-handed, **Z-up** (same as Blender). +X right, +Y away from the viewer in front
view, +Z up.

## Mesh (object-local space)

```js
mesh = {
  verts: [[x, y, z], ...],            // plain number arrays
  faces: [{ v: [i0, i1, i2, ...],     // >= 3 vertex indices, counter-clockwise seen
                                      // from outside (right-hand rule = outward normal)
            uv: [[u, v], ...],        // per-corner UV, uv.length === v.length,
                                      // origin bottom-left, v up (Blender/OpenGL)
            mat: 0 }],                // material slot index into object.materials
  looseEdges: [[a, b], ...],          // wire edges not used by any face (often empty)
  seams: Set<string>,                 // UV seam edge keys, `${Math.min(a,b)}_${Math.max(a,b)}`
  smooth: false                       // true: smooth shading, false: flat (face normals)
}
```

Faces may be n-gons (planar or slightly non-planar, possibly concave). Two faces
that share an edge (a,b) list it in opposite directions when normals are consistent.
UVs for the same mesh vertex can differ between faces (at seams / island borders);
on a shared non-seam edge inside one UV island the two faces hold equal UVs.

## Scene passed to exporters

```js
scene = {
  objects: [{
    name: 'Cube',
    position: [x, y, z],              // object transform in Z-up world space
    quaternion: [x, y, z, w],
    scale: [sx, sy, sz],
    mesh,                             // as above
    materials: [0, 2]                 // slot -> index into scene.materials; may be []
                                      // (then faces use a default grey material)
  }],
  materials: [{
    name: 'Material',
    color: [r, g, b],                 // LINEAR 0..1 (Blender convention)
    alpha: 1,
    roughness: 0.5,
    metalness: 0,
    texture: null | {
      name: 'Bricks.png',             // unique file name within the export
      mime: 'image/png' | 'image/jpeg',
      bytes: Uint8Array,
      width: 1024, height: 1024,
      filter: 'linear' | 'nearest'    // nearest = pixel-art look
    }
  }]
}
```

A face whose `mat` slot is out of range of `object.materials` uses slot 0 (or the
default material if the object has none).
