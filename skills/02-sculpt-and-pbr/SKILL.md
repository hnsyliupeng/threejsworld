---
name: threejsworld-sculpt-and-pbr
description: Stage 3 geometry & physically-based material construction — T0-T5 geometry ladder, open-shell cavities, analytical variable-thickness lofts, Surface::shaped relief PBR, Specular AA, and hair/fur contracts.
---

# Skill 02: Procedural Geometry Ladder & `Surface::shaped` PBR

## 1. Geometry Tier Ladder (`T0`–`T5`)

| Tier | Primitive / Builder | Mandatory Rule |
|---|---|---|
| **T0** | `box`, `cylinder`, `sphere`, `ellipsoid`, `cone`, `torus`, `capsule` | Base structural masses & mechanical cylinders. Never fake curved handles with plain boxes. |
| **T1** | `lathe` (`LatheGeometry`) | Rotational symmetry (barrels, lenses, chalices, vases, insulators). |
| **T2** | `extrude` (`ExtrudeGeometry` + bevels) | **Strictly restricted** to genuinely planar machined plates, brackets, or flat flanges. |
| **T3** | `tapered-sweep` (`runtime/core/geometryPrimitives.ts#buildTaperedSweep`) | Must use **parallel-transport (Bishop) frames** — never raw Frenet-Serret frames that flip 180° at inflection points. |
| **T4** | `variable-loft` (`buildVariableThicknessLoft`) / `open-shell` | Curved props, grips, blades, shells, recessed pockets. Analytical field-gradient normals guarantee `distinctZ >> 10` and eliminate 2.5D cardboard slabs. |
| **T5** | `up-normal-cards` / `strand-curve` | Hair tufts, fur cards, grass blades, foliage clusters with upward sky-biased normals and non-degenerate UVs. |

## 2. Hard Topology Rules

- **Recessed Cavities & Holes**: Never embed a dark interior inside a `closed-solid` mesh. Mark the part `topologyClass: "open-shell"` with explicit `shellWallThickness > 0`, rim bevel, and backcap mesh.
- **No Extruded Cardboard Slabs**: Any organic/curved prop (`distinctZ` check in `forge_world/geometry_gates.py`) MUST pass `distinctZ > 10` on both `positions` and bounding depth; use `buildVariableThicknessLoft`.
- **Character & Hair Contracts (`--profile character`)**:
  - Set `anatomy.profile = "character"` with head ellipsoid (`headCenter`, `headRadii`) so `geometry_gates.py scalp` can verify hair crowns sit **proud of the skull** (`standProud: true`).
  - Hair lock `BufferGeometry` must declare valid non-zero `[0, 1]` UV spans (`uvRange: [0..1, 0..1]`) so hair anisotropy / strand variation textures map cleanly.

## 3. `Surface::shaped` Multi-Scale PBR Synthesis

Instead of flat uniform `roughness` + random Perlin color noise, couple albedo, micro-roughness, and cavity AO from a single heightfield at three physical spatial scales (`fine` ~2 cm, `medium` ~10 cm, `broad` ~50 cm):

```bash
python3 forge_world/pbr_surface_synth.py --preset wood-grain-fibers --size 256 --tile-metres 2.0 --seed 11 --out-dir out/textures/oak_plank
```

Or inside TypeScript (`runtime/core/shapedSurface.ts` + `runtime/three/createThreeSurface.ts`):
- `albedo.png` / `albedoSRGB` → **`THREE.SRGBColorSpace`**
- `normal.png` / `normalLinear` → **`THREE.NoColorSpace`** (GL tangent-space `+Y` up)
- `orm.png` / `ormLinear` → **`THREE.NoColorSpace`** (`R = AO/cavity`, `G = Roughness`, `B = Metalness`)

## 4. Physical Calibration & Specular Anti-Aliasing

Consult `knowledge/material-reference.json` for every material:
- **Never** leave bare metal albedo `#ffffff` (`max channel <= 0.96` sRGB, e.g. aluminum `#d0d5db`, gold `#f5cf70`).
- **Dielectrics**: `metalness = 0.0`, `ior` calibrated (`1.45–1.58`), `roughness >= 0.08` unless wet/polished glass.
- **Conductors / Glossy Clearcoat**: Enable `channelGating: true` and `specularAA: true` to clamp grazing silhouette sparkling when `roughness < 0.25`.
- **Translucent Materials (`glass`, `water`)**: Use `transmission > 0` with `opacity = 1.0` and `roughness < 0.15` — never fade glass via `transparent: true, opacity: 0.3`.
