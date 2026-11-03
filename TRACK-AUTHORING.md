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

## Ruler

Tap the **ruler icon** in the left toolbar, then tap two endpoints. Vertices are
preferred within the snapping radius, followed by edges. Otherwise the point
lands on a visible surface or the grid at the 3D cursor’s height. Dragging still
orbits; two fingers still navigate. In Edit Mode, snapping uses the control
mesh; Object Mode uses the visible modifier result. Hidden objects are ignored.
X-ray permits snapping through surfaces.

Measurements use world coordinates, including object scale, and default to
**meters** with **1 modeling unit = 1 meter**. **Ruler → Settings** changes the
display unit (m/cm/mm/ft), meters per unit, and snapping. For coordinates stored
in centimeters, choose `0.01` meters per unit. This changes measurement display;
it does not resize the model or change the separate BRRES export scale.

Completed measurements remain visible and are saved in the project/autosave.
They support Undo/Redo and individual deletion or clearing in Ruler Settings.
They store fixed world points rather than following moved or edited geometry.
Up to 200 measurements can be retained. Escape cancels the current endpoint;
Escape again or **Done** leaves the tool.

## Basic BRRES editor

1. Open **File → BRRES Editor… → Open BRRES…** and choose an uncompressed `.brres`.
   **Use current scene** creates an archive from the visible modeling scene,
   using scale 1 and a maximum texture dimension of 512. The modeling scene
   remains open separately.
2. Choose a resource. The inspector lists resource types and versions, archive
   byte order/size and model vertex/polygon counts. The **Materials** list shows
   each material separately, including color-only materials, and links to its
   image textures. A texture can be shared by several materials. Texture
   resources show dimensions, encoding name/ID, mip level count and encoded size.
3. For textures, choose width/height or **Fit longest edge**, an output format,
   and whether to preserve the mip count, generate a full chain, or keep only the
   base level. Dimensions are powers of two from 1 to 1024. **Replace image…**
   stages a new image; **Export PNG** saves the preview with alpha.
4. Tap **Apply texture changes**, then **Save & Send BRRES…**. The saved filename
   ends in `_edited.brres`. **Revert texture** restores that texture from the
   originally opened file. Editor changes are held in memory, separately from
   project autosave, until you save a copy. Opening another archive replaces them.

Preview supports I4, I8, IA4, IA8, RGB565, RGB5A3, RGBA8, C4, C8, C14X2 and CMPR.
Indexed textures use a palette with the same name, or one chosen explicitly.
Output supports the seven uncompressed formats: RGBA8 keeps full color/alpha,
RGB565 removes alpha, RGB5A3 reduces precision, and I/IA formats convert to gray.
I4/I8 intensity also supplies alpha. Editing a compressed or indexed texture
converts it to the chosen output format; CMPR/palette encoding is not included.
Resampling and mip generation use alpha-weighted area filtering.

The editor preserves existing model, material/shader, palette and animation
bytes. It updates smaller textures in place or appends larger textures and
updates the existing resource pointers. Consequently, reducing dimensions
reduces encoded texture memory but may not shrink the archive file. It is a
texture editor and resource inspector, not an importer for arbitrary BRRES
geometry or a TEV/shader editor. TEX0 versions 1 and 3 are supported; textures
with user metadata or unknown formats remain read-only. Files are limited to
128 MiB and replacement images to 4096 pixels per side / 32 MiB.

## Export and send

1. Use **File → Export as BRRES…**, or choose BRRES in Export Model.
2. All visible objects are included by default, with their assigned materials
   and textures in the same BRRES. **Selected objects only** is an explicit opt-in
   with a separate BRRES preference; hidden objects are excluded. This avoids
   exporting only the selected road and losing separate finish-line or boost
   objects. Choose a unit scale and
   maximum texture size (64–1024; default 512). The default name is
   `course_model.brres`, containing an MDL0 model named `course`.
3. Tap **Export & Send BRRES…**. Supported mobile browsers offer the system share
   sheet, including Save to Files/AirDrop. Other browsers download the file.
   ZIP is optional. If a material references a missing image, export reports the
   material name so you can upload that image before continuing.
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

## Supported new-model export subset and limits

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
npm run test:editor:browser
npm run test:materials:browser
npm ci --prefix test
npm run test:export --prefix test
```

The browser tests start their own local servers. The editor test covers desktop
and iPhone touch emulation, vertex/edge snapping in world units, measurement
settings/persistence/undo, texture resize/format/mipmap controls, download/reopen,
replacement images, larger appended textures, malformed-file errors and revert.
The material regression test exports separate Road, FinishLine and Boost objects
while only Road is selected, reopens the downloaded file, follows each material’s
texture link, and checks shared images, color-only materials, image-name collisions,
explicit selected-only exports and preservation after a texture edit.
The track browser test checks touch selection in all
three element modes, gesture cancellation, modifier settings, undo/apply/save,
image alpha/downscaling, imported materials, independent samplers and a real
BRRES download. Browser coverage uses Chromium, not iOS Safari.

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
lists and a draw split above 60,000 vertices. The editor tests cover all 11 texture decoders, seven output encodings,
alpha-weighted resizing, mipmaps, smaller in-place updates and larger appended
textures. They assert model-byte preservation and parse edited archives with
noclip. Optional broader compatibility checks were run on all 21 BRRES files in
RiiStudio’s pinned sample collection (including animation-only files); all opened,
and edited copies parsed successfully. Sample assets are not bundled.

```sh
RIISTUDIO_SAMPLES=../RiiStudio/tests/samples NOCLIP_PARSER=../work/noclip-parser.mjs node test/editor-samples.mjs
```

RGBA8 tiling is independently decoded in the core test. It does not exercise noclip's GPU renderer.

The writer and texture editor are original implementations informed by these open-source format
references, rather than a bundled converter:

- [RiiStudio BRRES library](https://github.com/snailspeed3/RiiStudio/tree/c5a7cd8d5e06c39d277d80f8c8514e3c44621836/source/librii/g3d): MDL0 resources, materials, shaders, display lists and dictionaries.
- [BrawlCrate MDL0 structures](https://github.com/soopercool101/BrawlCrate/blob/master/BrawlLib/SSBB/Types/MDL0.cs): binary layouts and versions.
- [noclip BRRES reader](https://github.com/magcius/noclip.website/blob/e47a8cc8a9fe16e83adc0bf19153ff04c666ceca/src/rres/brres.ts): independent compatibility test and GX parsing reference.
- [Dolphin texture decoder](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/VideoCommon/TextureDecoder_Generic.cpp): Wii tiled pixels, palettes, alpha and CMPR interpolation.
