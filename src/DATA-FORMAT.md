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
  creases: Set<string>,               // optional, infinitely sharp subdivision edge keys
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
    alphaMode: 'auto',               // auto / opaque / cutout / blend (BRRES)
    alphaCutoff: 0.5,
    doubleSided: true,
    wrap: 'repeat',                  // repeat / extend (BRRES)
    texture: null | {
      name: 'Bricks.png',             // unique file name within the export
      mime: 'image/png' | 'image/jpeg',
      bytes: Uint8Array,
      width: 1024, height: 1024,
      rgba: Uint8Array,              // BRRES only: decoded top-left-origin RGBA pixels
      filter: 'linear' | 'nearest'    // nearest = pixel-art look
    }
  }]
}
```

A face whose `mat` slot is out of range of `object.materials` uses slot 0 (or the
default material if the object has none).

## Modifier state

Editor objects and saved projects may include
`modifiers: [{type: 'subdivision', method: 'catmull-clark' | 'simple', levels: 0..3, enabled: true, boundary: 'smooth' | 'keep-corners' | 'keep-boundary'}]`.
Missing modifiers mean an empty stack. The current UI supports one subdivision
modifier per object. `mesh` always remains the editable control mesh until Apply;
`renderMesh` is transient evaluated geometry, never serialized. The app evaluates
modifiers before constructing an export scene. UVs use face-varying bilinear
interpolation so island seams are not welded. See `TRACK-AUTHORING.md` for limits.


## Ruler project state

The optional `ruler` project/snapshot field contains `metersPerUnit` (positive,
default 1), `unit` (`m`, `cm`, `mm`, or `ft`, default `m`), `snap` (default true),
and `measurements`: up to 200 `{a: [x,y,z], b: [x,y,z]}` world-coordinate endpoint
pairs. Endpoints are snapshots rather than mesh references. Old projects without
this field load with an empty meter-based ruler. These settings do not change
mesh coordinates or the separate export scale.

BRRES editor archives and texture edits are separate transient state and are not
serialized in modeling projects. Save them with the editor’s BRRES download.

## Track authoring

Optional flat material fields: `kclEnabled` (default true), `kclFlag` (16-bit
unsigned, default 0), `kclFinish` (editor label; forces exported flag 0). These
apply to every face referring to the material, through its object's slot table.

Project `track`: `{scale, start, clearance, template, templateName}`. `start` is
null or `{position:[x,y,z], rotation:[pitch,yaw,roll]}`. Position is in editor
Z-up model units; rotation is explicitly Wii Euler degrees. Export uses
`[x*scale,z*scale,-y*scale]`. `template` is an optional base64 KMP v2520; it is
immutable and stored with the project to support lossless section preservation.
New KMP exports contain generated test scaffolding; imported KMP exports patch
only the first KTPT position/rotation. `workspace` and color-overlay visibility
are transient UI state.

Creases are stored with the mesh and serialized as edge-key arrays, like seams.
Missing creases mean an empty set. Subdivision splits each crease into two sharp
child edges per level; smooth normals split across those edges in the viewport
and exports. Keep Corners pins boundary vertices with exactly one incident face
(the OpenSubdiv edge-and-corner rule); Keep All Boundary Edges pins every boundary
vertex. Old modifiers without a boundary setting retain Smooth; new modifiers
default to Keep Corners. Simple subdivision leaves original positions unchanged.
