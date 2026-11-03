# Basic track authoring and BRRES export

PocketMesh can build, texture, subdivide and export a **visual track model** as
`course_model.brres`. This is the first authoring milestone, not a complete
Mario Kart Wii course builder. A BRRES does not contain collision, checkpoints,
item/enemy routes, starting positions, respawns or the course archive.

## Editing

- Tap the **wrench / Modifiers** button. Add Subdivision Surface, choose
  Catmull–Clark smoothing or Simple subdivision, and set levels 0–3. Object Mode
  and all exporters evaluate it; Edit Mode shows the original control mesh.
  Apply in Object Mode to make the new vertices editable. Settings, Apply,
  undo/redo, duplication and project saving preserve the modifier state.
  UVs interpolate within each original face, keeping seams and material slots.
  Join follows the active object's modifier settings; apply modifiers first
  when joining objects with different settings.
- **Hold for about half a second** on a vertex, edge, face or object to enter
  multiselect. Further taps toggle items; **Multiselect → Done** returns to Set.
  This uses a long press and works without pressure-sensitive hardware.
  Moving the finger, adding another finger, cancelling the pointer or leaving
  the window cancels the pending hold. Double-tap loop selection is disabled
  while multiselect is active.
- **Material → Longest side → Downscale image** makes a smaller copy for that
  material. It keeps aspect ratio and PNG alpha, never enlarges the image and
  supports Undo. Other materials using the original image are unchanged.
- **File → Import OBJ + materials** accepts an OBJ, its MTL and referenced images
  selected together. **Material → Import MTL + images** imports just materials.
  Supported MTL fields are `newmtl`, `Kd`, `d`/`Tr`, `Ns` and a plain `map_Kd`
  filename (including spaces). Missing images and unsupported maps/options are
  reported. Images are matched by filename, ignoring case and folder prefixes;
  the app does not fetch files or URLs named in an MTL.
- Surface settings include **Lit / PBR preview** or **Unlit · Wii color/texture**,
  opaque/cutout/blend alpha, a cutout threshold and double-sided rendering.
  Texture filtering and Repeat/Extend are independent for each material.

## Export and send

1. Use **File → Export as BRRES…**, or choose BRRES in Export Model.
2. Choose visible objects or selected visible objects. Choose a unit scale and
   maximum texture size (64–1024; default 512). The default name is
   `course_model.brres`, containing an MDL0 model named `course`.
3. Tap **Export & Send BRRES…**. Supported mobile browsers offer the system share
   sheet, including Save to Files/AirDrop. Other browsers download the file.
   ZIP is optional.
4. On desktop, drag the resulting file onto [noclip.website](https://noclip.website/)
   to inspect its geometry and textures. RiiStudio/BrawlCrate can be used for
   further inspection and editing. This release has automated compatibility
   coverage against noclip's parser; desktop RiiStudio/BrawlCrate, actual iOS
   sharing and in-game compatibility have not been verified.

BRRES exports always bake object transforms and enabled modifiers, triangulate,
convert Z-up to Y-up (`x, z, -y`), and correct winding for mirrored transforms.
The unit scale multiplies positions after conversion. Export texture resizing
makes each dimension a lower power of two within the chosen limit; it does not
change the original image. This can change pixel aspect ratio, while UV mapping
keeps the image on the same surface. Use square or power-of-two source images
for predictable pixel density. Use **Unlit** preview for the closest match to
this exporter's material appearance.

## Supported BRRES subset and limits

- Big-endian BRRES v0, real NW4R resource dictionary search trees, MDL0 v11 and
  TEX0 v3 with 4×4 tiled RGBA8 pixels.
- Static rigid geometry with a single identity root bone, positions, normals,
  one UV set, per-face materials, and opaque/translucent draw lists.
- One TEV stage: material color, or texture multiplied by material tint; opacity,
  alpha cutout/blend, sidedness and nearest/linear Repeat/Clamp sampling.
- Up to 100,000 triangles per export, 1,024 materials, 1,024 pixels per texture
  dimension and 64 MB per file. Draws split below the 16-bit vertex limit.
  Subdivision has a separate 100,000 output-face preview budget; if edits exceed
  it, the viewport shows the control mesh with a warning until the level is
  lowered. Export reports the limit instead of producing a truncated file.
- No animations, skinning, palettes, compressed textures, mipmaps, multiple UV
  sets, arbitrary shader graphs, game lighting, normal maps or PBR conversion.
  Lit/PBR materials export as unlit color/texture. Loose edges/points are omitted.

A playable track additionally needs appropriate **KCL collision**, **KMP race
configuration**, associated model resources (such as the minimap/sky when used),
and correct **SZS packaging** for its replacement slot. These are not generated
by this change. Noclip is a visual viewer, not a Mario Kart race simulation;
opening a model there cannot confirm collision, checkpoints or race behavior.
[Wiimm's SZS Tools](https://szs.wiimm.de/) provides tools for these course files.

## Original example

```sh
node examples/make-track.mjs
```

This writes an original textured circular road to `work/track-example/` as both
`course_model.brres` and an editable `example-track.pocketmesh.json`. It includes
no Nintendo assets. Its BRRES unit scale is 100; set the same scale when
re-exporting the companion project. It is a model preview, with no KCL/KMP/SZS.

## Validation and format references

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:track:browser
npm ci --prefix test
npm run test:export --prefix test
```

The browser test starts its own local server. It checks touch selection in all
three element modes, gesture cancellation, modifier settings, undo/apply/save,
image alpha/downscaling, imported materials, independent samplers and a real
BRRES download. It uses Chromium iPhone viewport/touch emulation, not iOS Safari.

The optional independent parser test uses a separate noclip source checkout:

```sh
git clone https://github.com/magcius/noclip.website ../noclip.website
git -C ../noclip.website checkout e47a8cc8a9fe16e83adc0bf19153ff04c666ceca
node test/build-noclip-parser.mjs ../noclip.website
NOCLIP_PARSER=../work/noclip-parser.mjs npm test
```

The test bundle keeps noclip's BRRES/display-list parsers and the relevant
material optimizer code; UI/render-only imports and unused WASM initialization
are excluded. Tests check dictionary lookup, decoded geometry, reflected
winding, Y-up bounds, UV orientation, material/sampler settings, alpha draw
lists and a draw split above 60,000 vertices. RGBA8 tiling is independently
decoded in the core test. It does not exercise noclip's GPU renderer.

The writer is an original implementation informed by these open-source format
references, rather than a bundled converter:

- [RiiStudio BRRES library](https://github.com/snailspeed3/RiiStudio/tree/c5a7cd8d5e06c39d277d80f8c8514e3c44621836/source/librii/g3d): MDL0 resources, materials, shaders, display lists and dictionaries.
- [BrawlCrate MDL0 structures](https://github.com/soopercool101/BrawlCrate/blob/master/BrawlLib/SSBB/Types/MDL0.cs): binary layouts and versions.
- [noclip BRRES reader](https://github.com/magcius/noclip.website/blob/e47a8cc8a9fe16e83adc0bf19153ff04c666ceca/src/rres/brres.ts): independent compatibility test and GX parsing reference.
