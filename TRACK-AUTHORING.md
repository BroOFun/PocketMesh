# Track workspaces and BRRES / KCL / KMP export

PocketMesh shares one model and camera between **Course Model**, **KCL** and **KMP**
workspaces under **Track Editor**, alongside the **SZS** archive editor.
It exports `course_model.brres`, `course.kcl` and `course.kmp`.
The KMP editor supports a start point and automatic drive-test scaffolding,
or updating the first start point in an existing KMP. Full race authoring still requires other tools. The SZS editor replaces files in an existing track package.

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

## Backface overlay

Backfaces have a subtle red tint by default; front faces keep their normal
materials and textures. It works in Model, KCL and KMP, in Object and Edit Mode.
In wireframe, backs get a faint red fill while front faces remain unfilled.
Single-sided materials temporarily show their backfaces while the overlay is on.
This is a viewport aid and does not change material sidedness, normals or exports.

Toggle **Viewport Shading → Backface overlay: on/off**, or use **Settings →
Viewport → Backface overlay (subtle red)**. Your choice is remembered on this
device, including when reopening the app or loading a project. To fix a red face,
select it in Edit Mode and use **Shading → Flip Normals** or **Recalculate Outside**.

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
it does not resize the model or change the shared Wii export scale (BRRES, KCL and KMP).

Completed measurements remain visible and are saved in the project/autosave.
They support Undo/Redo and individual deletion or clearing in Ruler Settings.
They store fixed world points rather than following moved or edited geometry.
Up to 200 measurements can be retained. Escape cancels the current endpoint;
Escape again or **Done** leaves the tool.

## Basic BRRES editor

1. Open **Track Editor → Course Model → Open BRRES…** and choose an uncompressed `.brres`.
   **Use current scene** creates an archive from the visible modeling scene,
   using the shared Wii export scale and a maximum texture dimension of 512. The modeling scene
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

## KCL workspace

Use **Track Editor → KCL** in the option bar or File menu.
The viewport, materials and camera are shared. Drag/pinch navigation works as
before; tapping a surface selects its material in the collision panel.

- Choose any of the **32 base types**, any variant (0–7), BLIGHT/effect index,
  wheel depth, trickable, reject-road and soft-wall bits. Raw hexadecimal flags
  are supported. Road, boost panel/ramp, off-road and wall presets speed this up.
- **Finish line** stores an editor label and exports normal road `0x0000`.
  Its white marker remains visible in KMP. It does not itself define a lap gate.
- **Include in KCL** can exclude scenery or decals. Hidden objects are omitted.
  The assignment affects every face using that material, including other objects.
  Split the material in Model if those faces need different collision behavior.
- **Focus this material** frames its geometry. **Colors On/Off** controls the
  collision tint over the existing rendered model, preserving textures.
- **Road type list** lists all 256 base-type/variant combinations, with search,
  expandable entries and CSV export. Unknown and track-slot-dependent effects
  are marked. A second CSV export lists the project's material assignments.
- **Export & Send KCL** writes binary Wii collision: transformed, triangulated,
  evaluated meshes, normalized prisms and a conservative octree. Limits are
  65,535 prisms, 65,536 vectors per pool and a 64 MB octree. Degenerate triangles
  are skipped and reported. Surface winding determines collision direction.

This version authors collision from the shared scene; importing arbitrary KCL
files and editing their existing prism/octree structures is not included.
Moving water, conveyors, cannons, sound/effect triggers and some variants also
need the appropriate KMP objects/routes, lighting data or track replacement slot.
Selecting a flag alone does not create those dependencies. Boost ramps and jump
pads are already trickable; avoid enabling the additional trick flag on them.

### Shared controls and material images

Orbit, pan, zoom, perspective/orthographic and view-axis buttons work in every
workspace. KCL also offers the same **Move / Rotate / Scale** object gizmos as
Model. These transform the shared mesh and therefore affect subsequent BRRES and
KCL exports. KMP offers **Move / Rotate** gizmos for the start point: X/Y handles
snap height to the nearby model surface, while Z changes height directly. Rotate
changes driving yaw. Both support project Undo/Redo. G/R/S choose the corresponding
gizmos in KCL; G/R do so in KMP. Home frames the selection (Start in KMP).

**KCL → Materials & flags** shows actual image thumbnails, texture filenames and
current collision assignments. Color-only materials show a swatch, and numeric
material IDs distinguish repeated names. Select a card, then assign its road type.
**Show textures on track** switches to Material Preview and hides collision tint;
**Colors On/Off** in the shelf toggles tint again. KCL types have no fixed required
texture: the same image can be normal road, boost, or another assigned behavior.

## KMP workspace

1. Choose **KMP → Place Start**, then tap a visible model surface. With no start
   point yet, KMP activates placement automatically. The point
   uses the hit's height (including sloped or raised roads), plus **Height above
   surface** (default 0.2 model units). Picking works from either side of a face,
   even with backface culling or wireframe display. Collision flags no longer block
   placement: a non-drivable or disabled surface prompts a warning to fix its KCL
   assignment. There is no invisible ground-plane fallback.
2. Choose **Aim Start** and tap ahead on the road, or enter a Wii yaw in degrees.
   0° points toward editor −Y; 90° points toward +X. Cardinal directions avoid
   the vanilla minimap start-line rotation issue. The arrow previews the heading.
3. **Start settings** also exposes coordinates and **Snap height again**.
   Editing X/Y re-snaps height to the nearest road level to the previous height,
   so a bridge does not always force the point onto its topmost surface.
4. Set **Course model export scale** consistently. This is now one project setting
   shared by BRRES/KCL/KMP. Exports convert editor Z-up to Wii Y-up (`x,z,-y`).
   Previously exported files must be re-exported after changing this scale.
5. Tap **Export & Send KMP**. With no imported KMP, PocketMesh creates an original
   temporary test setup: linked enemy/item paths, four checkpoints, a lap counter,
   one key checkpoint, respawn at Start, two cameras and stage settings. This
   avoids empty path sections that can freeze Mario Kart Wii. The loop has a
   5,000-Wii-unit radius near Start and is a placeholder, not a route fitted to
   your geometry. Use **Time Trials** for initial driving/collision tests; CPU
   racing, respawn coverage and route-dependent items need fitted routes later.
   Draw your own checkpoint loop using the checkpoint tool below. The finish
   material is only a reference label.
6. Alternatively, **Open existing KMP** from your own working track package.
   PocketMesh reads its first start point and checkpoint gates/groups. Export
   updates the first start point and any edited checkpoint sections. Untouched
   checkpoint bytes, other KTPT entries, player indices, padding, other sections
   and unknown section data are preserved. The existing routes are not moved to
   fit a new mesh. **Use automatic test setup** detaches that base file and resets
   the authored checkpoints to the temporary loop on export.

Material flags, finish labels, export scale, start position/heading/clearance,
checkpoint edits and an imported KMP are included in project save/autosave and
Undo/Redo. Workspace switching itself does not reset the model, history or camera.

A game test still needs a suitable **SZS track package** with the BRRES, KCL and
KMP, plus required resources such as minimap/sky and any referenced object files.
Use **SZS → Open SZS** to replace files in an existing package. Noclip validates visuals, not racing
or collision. No Wii/Dolphin gameplay test has been performed for these exports.

### Checkpoint drawing

Choose **KMP → Checkpoints** in the sidebar or shelf. This tool opens **Top
Orthographic** view by default while keeping your model and current zoom. In
**Draw**, click/touch and drag across the road, then release to add a gate. Drag
from its left edge to its right edge as seen facing the racing direction. The
arrow previews which way racers cross it; **Flip direction** swaps its endpoints.
The first drawn gate defaults to **Lap**, then the tool switches to **Normal**.
Select **Normal**, **Key**, or **Lap** in the top controls before drawing.

In **Edit**, drag an endpoint to reshape a gate or drag its line to move the whole
gate. Tap a line to select it. **Checkpoint settings** contains exact endpoint
coordinates, type, key ID, respawn index, direction, and driving order. **Earlier /
Later** reorders within a group; **Delete checkpoint** removes the selection.
**Number keys in order** assigns consecutive IDs after the lap line for a single
route group. **Top view** restores the overhead view; **Done** exits drawing.
Two-finger pan/pinch, view buttons, and desktop middle/right-mouse navigation
remain available. Adding a second finger or canceling a drag discards its preview.
Each completed creation, move, type change, reorder, or deletion supports Undo.

Normal gates are blue, keys green, and the lap gate pink. Use one lap gate and
pass key IDs in driving order. Dotted side links show the corridor between gates;
the settings panel flags missing lap/key gates, inconsistent key numbers, and
folded/backward connections. Gates have no height in the game: they extend
vertically. The displayed height follows the surface where drawing starts.
These checks help author a route but do not prove it is race-ready.

New drawings form one closed checkpoint group in drawing order. Imported KMPs
retain their existing group links, including branches. Choose a group in settings
to append lines to it; reordering stays inside that group. Removing the last line
of an imported group is disabled so its connections cannot silently break. This
basic tool edits up to 255 gates; it does not create branch-group connections or
edit respawn positions, enemy routes, or item routes. Imported checkpoint data is
preserved byte-for-byte until edited. Once edited, CKPT/CKPH are written using the
shared course-model export scale (100× by default), including when replacing
`course.kmp` in the SZS editor. Other imported sections remain unchanged.

The checkpoint binary tests cover axes/scale, types, direction, sequence and group
links, malformed files, cloning for undo, and imported KMP preservation. Browser
tests exercise desktop, phone, and landscape drawing/editing, cancellation,
key numbering, downloads, and SZS replacement. A convex authored test loop was
checked with Wiimm; its independent enemy/item-route fixture was fitted to that
loop. In-game validation still requires Wii/Dolphin.

Format references: [RiiStudio checkpoint reader/writer](https://github.com/riidefi/RiiStudio/blob/master/source/librii/kmp/io/KMP.cpp),
[Wiimm checkpoint convexity checks](https://github.com/Wiimm/wiimms-szs-tools/blob/master/project/src/lib-kmp.c),
and [Lorenzi's checkpoint editor](https://github.com/hlorenzi/kmp-editor/blob/master/src/viewer/viewerCheckpoints.js).

## SZS archive editor

1. Tap **Track Editor → SZS** in the option bar or File menu. Open an
   existing `.szs` (Yaz0-compressed U8) or uncompressed `.u8`/`.arc` track archive.
   Browse all folders/files or search by path/type; large listings are paginated.
   **Automatically update course files** starts enabled for each opened archive.
   It inserts the current project on opening, then refreshes `course_model.brres`,
   `course.kcl` and `course.kmp` after committed edits and undo/redo. Geometry,
   transforms, modifiers, materials, images/downscaling, collision flags, start
   points, checkpoints and shared export scale are tracked. Identical exported
   bytes are left alone; camera and selection changes do not replace files.
   A notification names the updated files, and each file has a persistent status
   and update time. These are staged in memory; save the SZS copy to retain them.
2. Select a file and choose **Replace selected file…**. The archive path stays
   the same regardless of the uploaded filename. **Download selected file** extracts
   its current bytes. **Revert selected file** or **Revert all replacements** restores
   the originally opened version. Manual course replacements (including BRRES
   editor replacements) and individual reverts pause automatic updates for that
   file. **Resume automatic updates** returns it to the current project. Reverting
   all files turns automatic updates off so the restored files stay intact.
3. **Use current project course files** exports all visible scene objects/materials
   to `course_model.brres`, material collision to `course.kcl`, and the current
   start/KMP setup to `course.kmp`, using the shared Wii scale. All three must
   already exist uniquely in the package. All exports must succeed before any
   are staged. For duplicate basenames, select and replace each exact entry.
   The individual file card also offers a current-project replacement button.
4. A selected BRRES can open in the texture editor. After editing, return to
   **SZS**, select the destination file and choose **Replace with BRRES editor:**
   followed by the displayed archive name. This copies the texture editor's
   current result into that selected entry; it does not happen automatically.
5. Choose **Prepare SZS download**, then **Save & Send SZS…**. Compression runs in
   a background worker; the final tap opens sharing/download on supported devices.
   Reopen the saved copy to inspect it. Pending archive edits are separate from
   project autosave and are lost when closing/reloading the app or opening another
   valid archive. Invalid imports preserve the current archive and replacements.
   Automatic mode checks for changes again before packing. If a file cannot be
   exported, its last valid bytes remain intact and its status explains the error;
   saving is blocked until it is fixed or **Keep archive file** explicitly retains
   that file. Missing or duplicate destinations are never guessed. Updates to
   the other valid files still proceed. Changes during compression invalidate the
   prepared copy; changes after compression trigger repacking on the share tap.

Untouched file bytes, names, directory hierarchy, empty directories and node order
are preserved. Repacking updates file offsets/sizes and aligns data to 32 bytes.
Limits are 128 MiB unpacked and 50,000 entries. This supports Wii U8/Yaz0 archives,
not every format that uses the SZS extension (e.g. SARC, WU8 or other compression).
It does not add/remove/rename entries, import arbitrary BRRES geometry into Model,
or automatically fit the donor archive's minimap, sky, object placements or routes
to a new track. In-game validation still requires Wii/Dolphin.

### Format and compatibility checks

`npm test` includes all 65,536 flag combinations, prism reconstruction, octree
lookups around 400 triangles, axis/scale conversion and KMP section preservation.
`npm run test:workspaces:browser` covers desktop and emulated iPhone workspace
controls, material assignments, finish labels, surface-height placement, heading,
file downloads, KMP import and project/undo behavior.
`npm run test:szs:browser` covers desktop/emulated-iPhone start placement on
back-facing and disabled-collision surfaces, camera/transform gestures, material
image previews, SZS import/search/pagination, replacement/revert, atomic course
export, error preservation, worker compression and downloaded archive contents.
`npm run test:szs-sync:browser` covers desktop and emulated iPhone automatic
updates, texture downscaling, checkpoints, scale, undo/redo, manual overrides,
failure retention, missing/duplicate destinations and stale-download prevention.
`WIIMM_BIN=/path/to/wiimm/bin node test/szs.test.mjs` additionally checks
independent extraction/repacking by Wiimm. Empty files are tested directly;
Wiimm’s extractor treats zero-length entries as extending to the next offset.

For independent checking with locally downloaded tools and external samples:

```sh
WIIMM_BIN=/path/to/wiimm/bin RIISTUDIO_SAMPLES=/path/to/RiiStudio/tests/samples node test/track-files.test.mjs
```

Wiimm v2.42a parses the generated files and reports no KCL or KMP warnings for
the test fixtures (the intentional item-route loop produces an informational
hint). These file checks are not an in-game compatibility guarantee.

Sources: [U8 archive format](https://mkwiiki.org/wiki/U8_(File_Format)),
[Yaz0 compression](https://mkwiiki.org/wiki/Yaz0_(File_Format)),
[KCL format](https://mkwiiki.org/wiki/KCL_(File_Format)),
[KCL types and variants](https://mkwiiki.org/wiki/KCL_flag),
[game collision attribute definitions](https://github.com/doldecomp/mkw/blob/main/src/field/KCollision.hpp),
[KMP format](https://mkwiiki.org/wiki/KMP_(File_Format)),
[RiiStudio KMP reader](https://github.com/riidefi/RiiStudio/blob/master/source/librii/kmp/io/KMP.cpp),
[Wiimm's SZS Tools](https://github.com/Wiimm/wiimms-szs-tools),
[required course resources](https://mkwiiki.org/wiki/Common_Crash_Causes).

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
npm run test:backfaces:browser
npm run test:materials:browser
npm ci --prefix test
npm run test:export --prefix test
```

The browser tests start their own local servers. The backface test compares
rendered front/back pixels in desktop and emulated-iPhone layouts, checks lit
and textured materials, wireframe, edit/workspace views, single-sided visibility,
flip/undo, saved toggle preferences and byte-identical BRRES exports. The editor test covers desktop
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

## Creases and boundary control

In **Modifiers → Subdivision Surface**, use **Add Creases** before Apply.
Select one or more faces, press **Mark Creases**, then **Done · Preview**.
All edges of each chosen face receive a fully sharp crease. Use **Remove Creases**
on selected faces or **Clear All Creases** in the modifier panel to undo markings.
Unselected creased edges are magenta in Edit Mode. Creases persist through project
save/load, undo, duplication, and common topology operations; they also survive
Apply and produce split shading normals in exported models. Fractional crease
weights are not exposed in this basic version.

**Boundary → Keep Corners** fixes boundary vertices touching one face while
smoothing the rest of the border, following the
[OpenSubdiv boundary rules](https://opensubdiv.org/docs/subdivision_surfaces.html#boundary-interpolation-rules).
**Keep All Boundary Edges** preserves the entire open outline, useful for road
edges. **Smooth** retains the earlier rounded-boundary behavior. Simple subdivision
already preserves the shape, so its boundary setting has no effect.

In Object Mode, tap **Multiselect** or hold an object to enter multiselect.
Tap any selected object to remove it, including one that is not active.
The same selection works in the Scene list and with group transforms.

## Track Editor and 100× Wii exports

The **Track Editor** menu contains **Course Model**, **KCL**, **KMP**, and **SZS**.
Course Model opens the BRRES resources/textures panel; **Edit geometry** returns
to the shared modeling viewport. The menu is also available from File.
Move, Rotate, and Scale stay on the left toolbar; the duplicate bottom-row
transform actions have been removed.

New projects export the course model at **100×** the editor coordinates. KCL
collision, authored KMP start coordinates, and generated files inserted into SZS
use the same course-model export scale. The viewport and meter ruler stay at
modeling size. Existing projects with the former default scale of 1 migrate to
100; custom scales are retained. Changing the scale in Course Model updates all
three exporters; **Use 100×** restores the Mario Kart Wii preset. Re-export the
three files together after a change. Existing imported BRRES archives and preserved
sections of imported KMP templates remain in their original Wii coordinates.

## Tap extrusion

In Edit Mode select the boundary vertices, edges, or faces, then press **Extrude**
on the bottom row or left toolbar. **Drag extrude** retains the ordinary modal
extrusion. Enable **Tap extrude** to extrude repeatedly toward tapped points in
the view plane at the selection's depth. Dragging continues to navigate the view.
With nothing selected, a tap adds a vertex and subsequent taps extend a wire.
**Done** or Escape returns to selection. Desktop users can also Ctrl-right-click
in Edit Mode to extrude to the cursor.

**Tap extrude** and **Rotate to tap** start off. Rotate to tap turns each new section
toward the tap. With **Rotate source** on, the previous section turns halfway and
the new section completes the turn, matching the source/destination behavior of
[Blender's cursor extrusion](https://github.com/blender/blender/blob/main/source/blender/editors/mesh/editmesh_extrude.cc).
Turn Rotate source off to leave the previous section fixed. Each tap is undoable,
preserves face materials, and keeps the new section selected for the next tap.
Use top/front/side views to control the plane of a track segment; this tool does
not automatically snap new sections onto another surface.
