---
name: threejsworld-intake-observation
description: Stage 1 & Stage 2 visual intake — 8-layer structural observation, Otsu foreground isolation, de-lighting, 3x3 spatial decomposition, target socket binding, and S3S-World v2 spec drafting.
---

# Skill 01: Reference Intake, 8-Layer Observation & S3S-World v2 Spec

## When to Run

Run at the start of every asset or world-scene request — whether driven by a reference PNG (`image_intake.py`) or a pure text prompt (synthesizing concrete spatial ratios from `knowledge/material-reference.json` and `knowledge/species-presets.json`).

## Stage 1 Checklist (Reference Image Mode)

1. **Probe Image & Foreground Mask (Otsu, never fixed percentiles)**:
   ```bash
   python3 forge_world/image_intake.py probe --image ref.png
   ```
   Confirm foreground fraction is non-trivial (`0.08`–`0.92`) before writing geometry.
2. **De-light Before Sampling Colors**:
   Never sample raw sRGB pixels from shadowed or specular highlights as diffuse `baseColor`. Run:
   ```bash
   python3 forge_world/image_intake.py delight --image ref.png --out .threejsworld/ref_delit.png
   ```
3. **Slice 3×3 Spatial Zones**:
   ```bash
   python3 forge_world/image_intake.py slice --image ref.png --out-dir .threejsworld/zones --grid 3
   ```
   Read small fasteners, ports, rivets, hair parting, or bark scars from zoomed zone crops rather than tiny full-frame thumbnails.

## The 8-Layer Observation Protocol (Always Write Before Coding)

Before writing a single Three.js line, record all 8 structural layers in your working spec (`schemas/s3s-world.v2.schema.json`):

1. **Overall Silhouette & Bounding Ratios**: `width : height : depth` in metres, plus front/side curvature vs straight chamfers.
2. **Structural Part Decomposition**: Explicit parent-child `parts[]` tree; note sagittal `-l` / `-r` paired parts so mirrored left/right chirality never drifts.
3. **Topology Class Per Part**:
   - `closed-solid` (no internal hole pockets; solid volume)
   - `open-shell` (recessed cavities/cockpits/screens/vents using real wall thickness + backcap)
   - `thin-sheet` (capes, membranes, cloth, petals, leaves; specify `upNormalCards` if foliage)
   - `strand-curve` (tubes, hoses, cables, hair locks; parallel-transport frame)
   - `botanical-skeleton` (bark trunk/branches + leaf clusters + trunk collider)
   - `material-only` (grouping containers / socket empties)
4. **Tier Assignment (`T0`–`T5`) & Detail Inventory**:
   For `--strict`, list fine fasteners, seams, knobs, stitches, and trim in `detailInventory[]` with `minFeatureSize`, `geometryTier`, `partId`, and `resolved: true`.
5. **Surface Material & `Surface::shaped` Relief Budget**:
   Map every part to `knowledge/material-reference.json` priors (`baseColor`, `roughness`, `metalness`, `ior`, `clearcoat`, `sheen`, `channelGating`, `specularAA`, `shapedSurface`).
6. **Runtime Articulation (`runtimeAction`)**:
   Define `pivot`, `sockets[]` (for `--target` accessories such as scopes, helmets, weapons, lanterns), `destructionGroup`, and `explodeWithParent` flags for sub-assemblies.
7. **Target Socket / Attachment Binding**:
   When the user provides `--target` (e.g., attaching an accessory to a parent chassis or character hand), bind to an explicit named socket (`sockets[]`) and verify AABB contact gap (`max_gap <= 0.015`).
8. **Scale & LOD World Context**:
   Record real-world scale in metres and, if `botanical` or `world-scene`, specify `lodAndWorld` (burial depth, LOD distances, impostor elevation counts, Cluster DAG leaf error).

## Strict Validation Gate

```bash
python3 forge_world/spec_validator.py my_asset.spec.json --strict-quality
```
Do **not** advance to Stage 3 until `spec_validator.py --strict-quality` returns exit code `0`.
