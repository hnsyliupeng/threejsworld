# ThreeJSWorld — Universal Procedural Photorealistic 3D Modeling & Agent Skills

**ThreeJSWorld** fuses five leading open-source 3D / WebGPU / procedural modeling architectures into one **universal, deterministic, quality-gated Procedural Photorealistic 3D Modeling & World-Building Agent Skill System**:

| Reference Architecture | Core Contribution Integrated into ThreeJSWorld |
|---|---|
| **[img2threejs](https://github.com/img2threejs/img2threejs) + [`docs/`](https://github.com/img2threejs/img2threejs/tree/main/docs)** | Agent-agnostic **Forge** state machine, S3S (`ObjectSculptSpec` v2) intermediate representation, T0–T5 hybrid geometry ladder, `open-shell` / recessed SDF allow-lists, sagittal chirality mirror gate, `detailInventory`, de-lighted photo projection, `sculptRuntime` (pivots/sockets/colliders), pre-render geometric gates (`distinctZ`, `scalp_exposure`, `part_coverage`), and **Divine Eye** + 6-pass `render-profile.v2` visual review loop. |
| **[dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree)** | Clean **Skeleton Growth (RNG) vs Skeleton Meshing (RNG-free LOD)** decoupling (`sectionStride`, `segmentFactor`, `leafStride`, `leafScale`), hierarchical recursive branch growth (`levels`, `gnarliness`, `taper`, `twist`, directional `force`, `trellis` attractors), rounded canopy normals, and vertex `windFactor` weights. |
| **[yomotsu/vegetation](https://github.com/yomotsu/vegetation)** | **Zero-DOM Pure-Data Core (`core/`) vs Renderer Wrapper (`three/`)** guaranteeing byte-identical determinism across Node/Workers/WebGL2/WebGPU; **Coverage-Preserving Alpha Mipmaps**; `upNormalCards` (eliminating `DoubleSide` dark undersides); convex-hull chamfered rocks with 3D world-space moss masks; ground-embedded stems/roots (`-0.3 m` / `-3 mm`); and 5-tier LOD (LOD0–LOD3 + CPU orthographic LOD4 impostor cards). |
| **[VictorZakharov/threejs-nanites](https://github.com/VictorZakharov/threejs-nanites)** | Pure Three.js (`three/webgpu` + `three/tsl`) **Cluster-DAG Virtualized Geometry** (128-tri meshlets, boundary-locked simplification, `err = max(childErr, ownErr)` propagation), **4-direction CPU alpha coverage solver** (solving `√2` canopy blowup), two-phase HZB occlusion + compute **Software Rasterizer / Visibility Buffer**, **4-elevation unlit Albedo+Normal Impostor Atlases** re-lit dynamically, curved-planet shaders, TAA upscaling, and automated headless GPU/visual probes. |
| **[SamG-Coder/solstice](https://github.com/SamG-Coder/solstice)** | **`Surface::shaped` Multi-Scale Relief PBR Synthesis** (real height in metres → 2 cm / 10 cm / 50 cm relief bands → physically coupled albedo/normal/roughness/cavity/wear), **Specular AA** (normal-variance roughness boost), data-driven `.species/.grass/.weather` golden-angle botanical grammar, modular part-ablation (`--without`), **Lumen-style Voxel Clipmap + Screen-Space GI**, Hillaire 2020 atmosphere, Horizon Zero Dawn ranked volumetric clouds, and paged residency streaming. |

---

## Repository Structure

```text
threejsworld/
├── SKILL.md                               # Root Agent Skill router (universal entry point)
├── skills/                                # Composable modular Agent Skills (agentskills.io spec)
│   ├── 01-intake-observation/             # 8-layer observation, Otsu mask, de-light, 3x3 crops, S3S-World v2 spec
│   ├── 02-sculpt-and-pbr/                 # T0-T5 ladder, anti-2.5D lofts, SDF, open-shell, Surface::shaped PBR, Specular AA
│   ├── 03-botanical-world-lod/            # Skeleton/mesh split, golden-angle shoots, Cluster DAG, 4-dir coverage, impostors
│   └── 04-visual-verification/            # Pre-render geo gates, 6-pass render-profile.v2, Divine Eye, --without ablation
├── docs/
│   ├── ARCHITECTURE_FUSION.md             # Deep architectural fusion & detailed subsystem breakdown
│   └── ANTI_PATTERNS_AND_LESSONS.md       # Measured failure records & hard invariants from all 5 repos
├── schemas/
│   ├── s3s-world.v2.schema.json           # Unified Structured 3D World Spec v2 JSON Schema
│   └── render-profile.v2.schema.json      # 6-pass multi-angle deterministic render contract schema
├── knowledge/
│   ├── material-reference.json            # Curated physical PBR priors + Surface::shaped tile parameters
│   └── species-presets.json               # Fused botanical & geological presets (ez-tree / solstice / vegetation)
├── forge_world/                           # Zero-dependency Python 3.11+ stdlib CLI tools & gates
│   ├── __init__.py
│   ├── state.py                           # Atomic pipeline checklist & bounded correction loop
│   ├── image_intake.py                    # Stdlib PNG probe, grid cropper, Otsu, de-light, Divine Eye, comparison sheets
│   ├── spec_validator.py                  # S3S-World v2 validator & strict-quality / chirality / physics gates
│   ├── geometry_gates.py                  # distinctZ 2.5D detector, winding, attachment gap, part coverage, scalp exposure
│   ├── pbr_surface_synth.py               # Surface::shaped multi-scale PBR PNG/buffer synth + coverage-preserving mipmaps
│   └── ts_codegen.py                      # Procedural Three.js TypeScript factory + sculptRuntime emitter
├── runtime/                               # Zero-DOM pure TypeScript core + Three.js runtime library
│   ├── core/                              # Pure math & typed arrays (Node / Worker / WebGL / WebGPU identical)
│   │   ├── index.ts
│   │   ├── prng.ts
│   │   ├── shapedSurface.ts
│   │   ├── geometryPrimitives.ts
│   │   ├── botanicalSkeleton.ts
│   │   └── clusterDag.ts
│   └── three/                             # Three.js / WebGPU wrapper layer
│       ├── createThreeSurface.ts
│       └── botanicalAsset.ts
├── examples/                              # Verified S3S-World v2 specs & interactive Three.js showcase
│   ├── vintage_camera.spec.json           # Hard-surface + leather + brushed chrome + SDF pocket + symmetric eyelets
│   ├── alpine_pine_grove.spec.json        # Conifer spiral skeleton + upNormalCards + Cluster DAG LOD0-4 + impostors
│   └── world_showcase.html                # Live interactive Three.js procedural grove + mossy boulder + ablation demo
└── tests/
    ├── test_forge_world.py                # Comprehensive Python stdlib unit & integration gate tests
    └── test_runtime.mjs                   # Native Node 22 TypeScript runtime core determinism & math tests
```

---

## Quick Start

### 1. Use as an Agent Skill

Point your coding agent (Claude Code, Codex, OpenCode, Hermes, Arena) at **`SKILL.md`** or link any skill under **`skills/`**:

```bash
# Example: install or symlink into your agent skills directory
ln -s "$(pwd)" ~/.claude/skills/threejsworld
# Or link individual modular sub-skills:
ln -s "$(pwd)/skills/02-sculpt-and-pbr" ~/.claude/skills/threejsworld-sculpt-and-pbr
```

### 2. Run the Zero-Dependency Python Forge Pipeline

Every script uses **Python 3.11+ standard library only** (`pip` install not required):

```bash
# 1. Initialize resumable workflow state
python3 forge_world/state.py init --state .threejsworld/state.json --profile prop --spec examples/vintage_camera.spec.json

# 2. Validate S3S-World v2 spec with strict geometric & material-physics gates
python3 forge_world/spec_validator.py examples/vintage_camera.spec.json --strict-quality

# 3. Emit deterministic TypeScript Three.js factory with sculptRuntime & Surface::shaped hooks
python3 forge_world/ts_codegen.py examples/vintage_camera.spec.json --out tmp/createVintageCameraModel.ts

# 4. Synthesize seamless Surface::shaped PBR maps (albedo/normal/ORM) or coverage-preserving mipmaps
python3 forge_world/pbr_surface_synth.py --preset granite-cracks-moss --size 128 --mipmaps --out-dir tmp/pbr_granite

# 5. Run pre-render geometric gates (distinctZ, winding, attachment gaps, part coverage)
python3 forge_world/geometry_gates.py --spec examples/vintage_camera.spec.json --mesh tmp/sample_mesh.json
```

### 3. Run Automated Verification Tests

```bash
# Run Python Forge & Gates test suite
python3 -m unittest discover -s tests -v

# Run native TypeScript pure-data core tests (Node 22+ built-in type stripping, zero npm install)
node --experimental-strip-types tests/test_runtime.mjs
```
