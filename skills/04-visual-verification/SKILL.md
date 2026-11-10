---
name: threejsworld-visual-verification
description: Stage 3.5 & Stage 4 deterministic geometry gates, 6-pass multi-angle render verification, interior_difference, OSIM-lite reconstruction rescue, --without ablation, and bounded self-correction.
---

# Skill 04: Geometric Gates, 6-Pass Render Harness & Visual Review

## 1. Pre-Render Geometric Gates (Run BEFORE Launching Browser)

Never waste render passes on broken geometry. Export mesh summary JSON and run:

```bash
python3 forge_world/geometry_gates.py --spec spec.json --mesh mesh_report.json
```

All 5 gates must pass:
1. **`distinctZ` Check**: Curved/sculpted solids must exhibit `distinctZ > 10` (blocks flat 2.5D slab extrusions).
2. **Sanity & Signed Volume**: Zero `NaN` vertices, zero degenerate triangles (`< 1e-10`), positive signed volume on watertight solids.
3. **Attachment Gap Check**: Attached `--target` / child parts must stay within `max_gap <= 0.015` (catches floating accessories).
4. **Explode / Pick Parity**: `sculptRuntime.explode(1.0)` must move parts radially without mutating parent-bound sub-parts, and `pickPart()` must resolve valid non-empty IDs.
5. **Scalp Exposure (`--profile character`)**: Check hair meshes against the skull ellipsoid (`geometry_gates.py scalp`) so zero bald patches puncture through hair caps.

## 2. Deterministic 6-Pass Render Profile (`schemas/render-profile.v2.schema.json`)

Render every asset with a clean `WebGPURenderer` / `WebGLRenderer` setup (`ACESFilmicToneMapping`, `LinearSRGBColorSpace` working → `SRGBColorSpace` output, hemisphere + studio key/fill/rim + directional CSM shadows):
1. `hero_front` (primary match angle)
2. `three_quarter` (`35°` azimuth, `22°` elevation — catches flat profile slabs!)
3. `rear_opposite` (`180°` azimuth — catches unmodeled backs)
4. `top_elevation` (`75°` elevation — catches floating attachments & hollow tops)
5. `closeup_microscope` (focused on `detailInventory` joints / materials)
6. `exploded_diagnostic` (`sculptRuntime.explode(0.6)` — validates part separation & hierarchy)

## 3. Multi-Signal `divine_eye` & Comparison Sheet Review

```bash
# Build side-by-side reference vs render comparison sheet
python3 forge_world/image_intake.py sheet --reference ref.png --render hero.png --out .threejsworld/compare.png

# Evaluate deterministic signals (IoU, ScaleDelta, Luma SSIM, Sobel Edges, HOG Objectness, Interior Difference)
python3 forge_world/image_intake.py evaluate --reference ref.png --render hero.png
```

### Interpreting Signals:
- **`silhouetteIoU >= 0.85` & `scaleDelta <= 0.08` & `interiorPassed`**: Hard silhouette & interior presence gates.
- **`interior_difference`** (`compute_interior_difference`): Evaluates pixels **strictly inside** the foreground mask across 4 vertical bands so missing faces, hollow panels, or flipped normals inside a valid silhouette fail immediately.
- **OSIM-Lite Reconstruction Rescue**: If `silhouetteIoU < 0.85` (e.g., pose/focal mismatch) while `scaleDelta <= 0.08` and `objectnessHOG >= 0.48`, verdict returns `"probe"` to adjust camera focal/orbit instead of scrambling healthy 3D proportions!

## 4. Feedback Priority & `--without` Diagnostic Ablation

Fix visual defects strictly in this order:
`silhouette` → `proportion` → `missing-parts` → `attachment` → `material` → `detail` → `lighting`

When a world scene or complex renderer looks wrong, perform **one-command `--without` ablation** (adapted from `solstice/apps/townkit`) to isolate the faulty subsystem rather than guessing:
- `--without foliage` / `--without shadows` / `--without normalMap` / `--without clearcoat` / `--without impostors`

## 5. Bounded Self-Correction Ceilings (`forge_world/state.py`)

Enforce hard loop ceilings via:
```bash
python3 forge_world/state.py record-loop --state .threejsworld/state.json --step-id divine-eye-and-interior --action refine-code --defect silhouette
```
- `maxPerPass = 3` attempts per stage
- `maxTotal = 6` total correction rounds across the entire asset
When `status` transitions to `TERMINATE_BOUNDED`, report the highest-scoring build along with exact measured diagnostics instead of spiraling endlessly.
