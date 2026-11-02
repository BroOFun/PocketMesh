# PocketMesh

A polygon modeler for iPhone, built around the way Blender works: Object and Edit Mode, vertex / edge / face selection, extrude, inset, loop cut, Blender-style Move / Rotate / Scale with axis locks and typed values, UV unwrapping, image textures, and export to OBJ, FBX, DAE and glTF.

It installs to your Home Screen and runs as a full-screen app. It works offline and keeps your scene on the phone.

## Install on iPhone

1. Open the app's address in **Safari**.
2. Tap **Share** (the square with an arrow), then **Add to Home Screen**, then **Add**.
3. Launch **PocketMesh** from the Home Screen.

There's no App Store, Mac or developer account involved. When a new version is published, the app picks it up the next time it is opened with a connection.

## What it does

| Area | Features |
| --- | --- |
| Shapes | Plane, Cube, Circle, UV Sphere, Ico Sphere, Cylinder, Cone, Torus, Grid. Each can be adjusted after adding (size, segments, rings, cap fill). |
| Selection | Vertex, edge and face modes. Tap, box select, edge loop (double-tap), edge ring, linked, more/less, boundary loop, all/none/invert. Set, Add or Subtract modes. X-ray to select through. |
| Transform | Move, Rotate, Scale and Shrink/Fatten. Drag anywhere, lock to X / Y / Z or a plane, tap twice for local axes, or type an exact value. Snap increments, proportional editing with six falloffs. Pivot: median, bounding box, individual origins, 3D cursor, active. Orientation: global, local, normal, view. Gizmo tools for direct handles. |
| Modeling | Extrude (region, individual, along normals), Inset (region / individual, depth), Loop Cut and Slide (multiple cuts), Subdivide, Fill, Grid Fill, Triangle Fill, Bridge Edge Loops, Merge (center, cursor, collapse, by distance), Delete and Dissolve, Duplicate, Separate, Join, Triangulate, Tris to Quads, Recalculate / Flip normals, Smooth / Flat shading, Mirror. |
| Objects | Origin to geometry or cursor, Apply location / rotation / scale, Separate by material / loose parts, Snap menu, Hide / Reveal, numeric transform panel, scene list. |
| UVs | Seams; Unwrap (conformal), Unwrap (minimum stretch), Smart UV Project, Lightmap Pack, Follow Active Quads, Cube / Cylinder / Sphere projection, Project From View, Reset. UV editor with **Straighten Grid**, Straighten, Straighten X/Y, Align X/Y/Auto, Align Rotation, Pack Islands, Average Island Scale, rotate (90° / 180°, and a Rotate tool that clicks to 0 / 90 / 180 / 270°), flip, weld, fit, stretch overlay, and UV layout PNG export. Pinch to zoom and twist to rotate the UV view. |
| Materials | Multiple material slots per object with per-face assignment. Base Color is a color (picker, palette, hex) or an image texture uploaded from Photos, the camera or Files, with optional color tint, Linear or Closest (pixel-art) filtering and Repeat / Extend edges. Generated UV-grid / checker textures. Roughness, metallic, alpha. |
| Viewport | Wireframe, Solid, Material Preview and Rendered shading; face orientation overlay; navigation ball with one-tap front / side / top views; perspective / orthographic. |
| Files | Export OBJ+MTL, binary FBX 7.4 (textures embedded), COLLADA DAE, glTF 2.0 (.glb or .gltf). Import OBJ. Save and open `.pocketmesh.json` projects. Exports go through the iOS share sheet (Save to Files, AirDrop, other apps). |

## Gestures

- **One finger drag**: orbit. **Tap**: select.
- **Two fingers**: drag to pan, pinch to zoom, twist to turn the view. **Two-finger tap**: undo. **Three-finger tap**: redo.
- **Map style** (Settings): one finger pans; two fingers pinch, twist and slide up/down to tilt, like a maps app.
- During Move / Rotate / Scale, drag anywhere on the viewport; two fingers still navigate.
- A hardware keyboard works too: Tab, G R S, X Y Z, E, I, Ctrl+R, A, F, M, U, Shift+A, Shift+D, Ctrl+Z, numpad views.

## Project layout

```
docs/            the built app (served by GitHub Pages)
src/             source modules, concatenated by build.mjs into docs/index.html
  DATA-FORMAT.md mesh and scene data format shared by the modules
  mesh.js        mesh data structure, primitives, modeling operators
  uv.js          unwrapping, projections, packing, straightening
  export.js      OBJ / FBX / DAE / glTF writers, ZIP writer, OBJ reader
  app_*.js       viewport, transforms, operators, UV editor, files, interface
assets/icons/    Home Screen icons
test/            Node and headless-browser tests
build.mjs        build script
```

## Build and test

```bash
npm install
```

```bash
node build.mjs
```

```bash
cd test && npm install && npm run test:export
```

`build.mjs` writes the app into `docs/`: one `index.html`, a vendored copy of three.js r160 (MIT, see `docs/vendor/THREE-LICENSE.txt`), the web app manifest, the offline service worker and icons. Serve `docs/` over HTTPS for the service worker and Home Screen install to work.
