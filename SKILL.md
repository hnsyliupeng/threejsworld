---
name: threejsworld-photorealistic-3d
description: General-purpose procedural photorealistic 3D modeling, botanical world synthesis, PBR material shaping, and multi-angle verification in Three.js (WebGL2 & WebGPURenderer) with zero external 3D asset files.
version: 2.0.0
---

# ThreeJSWorld — Procedural Photorealistic 3D Agent Skill

> **Fused Architecture**: `img2threejs` (Forge 4-Stage Pipeline & Hard Gates) × `solstice` (`Surface::shaped` Relief PBR & Botanical Grammar) × `ez-tree` (Skeleton/Mesh Decoupling) × `vegetation` (Zero-DOM `core/` Split & Alpha Coverage Mipmaps) × `threejs-nanites` (Cluster DAG `max`-Error Hierarchy & 4-Direction Coverage Impostors).

## Hard Laws (Non-Negotiable)

1. **Zero External Binary Models/Textures**: Generate 100% deterministic TypeScript + typed-array geometry and procedural PBR textures (`runtime/core/` + `forge_world/`). Never shell out to external AI mesh generators or paste external `.glb`/`.png` blobs.
2. **Every Run Starts Through `forge_world/state.py`**: Initialize `.threejsworld/state.json`, validate specs via `forge_world/spec_validator.py --strict`, check pre-render meshes via `forge_world/geometry_gates.py`, and run visual inspection via `forge_world/image_intake.py`.
3. **Never Guess Visual Quality From Text**: Render multi-angle views (front, back, 3/4, top, close-up, exploded) and evaluate both `hardGates` (`silhouetteIoU >= 0.85`, `scaleDelta <= 0.08`, `interiorPassed`) and human visual comparison sheets before passing.
4. **No Fake Volumetric Geometry**:
   - No 2.5D extruded cardboard slabs (`distinctZ <= 10`) for curved props/handles/blades — use `buildVariableThicknessLoft` with analytical field normals.
   - No subtractive negative-volume cavities inside `closed-solid` parts — use `open-shell` + wall thickness + backcap.
   - No `DoubleSide` dark-underside foliage cards — use `buildUpNormalCard` + `FrontSide`.
   - No bare `color: 0xffffff` metal or `metalness` + `roughness=0.1` without `channelGating` + `specularAA`.

## Profile Selection & Sub-Skill Routing

Classify the user's request into one of five profiles and load the matching sub-skills:

| Profile | Typical Targets | Primary Skills |
|---|---|---|
| `prop` | Mechanical tools, electronics, weapons, instruments, furniture | `01-intake-observation` → `02-sculpt-and-pbr` → `04-visual-verification` |
| `character` | Figures, busts, creatures, armor, hair/fur, articulated rigs | `01-intake-observation` → `02-sculpt-and-pbr` → `04-visual-verification` |
| `botanical` | Oak, pine, fir, willow, shrubs, grass tufts, weathered rocks | `01-intake-observation` → `03-botanical-world-lod` → `02-sculpt-and-pbr` → `04-visual-verification` |
| `architecture` | Modular stone buildings, roofs, docks, bridges, ruins | `01-intake-observation` → `02-sculpt-and-pbr` → `03-botanical-world-lod` → `04-visual-verification` |
| `world-scene` | Forest groves, villages, terrains with LOD0–LOD4 & Cluster DAG | `01-intake-observation` → `03-botanical-world-lod` → `02-sculpt-and-pbr` → `04-visual-verification` |

## Standard 4-Stage Execution Loop

```
Stage 1 (Intake) ──▶ Stage 2 (S3S-World v2 Spec) ──▶ Stage 3 (Build & Pre-Gates) ──▶ Stage 4 (Multi-View & Divine Eye)
   │                    │                               │                               │
   ▼                    ▼                               ▼                               ▼
image_intake.py      spec_validator.py --strict      pbr_surface_synth.py            render-profile.v2
8-layer observe      --target socket check           ts_codegen.py / runtime/        interior_difference + IoU
de-light + Otsu      detailInventory check           geometry_gates.py               maxPerPass<=3, maxTotal<=6
```

### Quick Commands

```bash
# 1. Start session state
python3 forge_world/state.py init --state .threejsworld/state.json --profile prop

# 2. Validate S3S-World v2 spec strictly before writing code
python3 forge_world/spec_validator.py examples/vintage_camera.spec.json --strict-quality

# 3. Synthesize Surface::shaped PBR maps (albedo sRGB + normal + ORM)
python3 forge_world/pbr_surface_synth.py --preset granite-cracks-moss --out-dir out/textures/stone --size 256

# 4. Generate Three.js TypeScript factory with sculptRuntime + upNormalCards + variable-loft
python3 forge_world/ts_codegen.py examples/vintage_camera.spec.json --out out/createModel.ts

# 5. Run pre-render geometry gates (distinctZ, watertight, attachment gaps, explode/pick)
python3 forge_world/geometry_gates.py --spec path/to/spec.json --mesh path/to/mesh_dump.json
```

## Composable Sub-Skills

- [`skills/01-intake-observation/SKILL.md`](skills/01-intake-observation/SKILL.md) — Reference photo intake, 8-layer anatomy, Otsu foreground isolation, de-lighting, 3×3 zone slicing, target socket contracts.
- [`skills/02-sculpt-and-pbr/SKILL.md`](skills/02-sculpt-and-pbr/SKILL.md) — Geometry Tier Ladder (T0–T5), `open-shell` pockets, variable-thickness lofts, `Surface::shaped` PBR, Specular AA, hair `standProud` & UVs.
- [`skills/03-botanical-world-lod/SKILL.md`](skills/03-botanical-world-lod/SKILL.md) — Botanical skeleton/mesh split, golden-angle shoots, ground embed, `upNormalCards`, coverage-preserving mipmaps, 4-dir coverage matching, Nanite Cluster DAGs.
- [`skills/04-visual-verification/SKILL.md`](skills/04-visual-verification/SKILL.md) — Pre-render geometry gates, multi-angle 6-pass render verification, `interior_difference`, OSIM-lite probe rescue, `--without` ablation, bounded loop control.
