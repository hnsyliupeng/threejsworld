---
name: threejsworld-botanical-world-lod
description: Botanical procedural modeling, terrain grounding, coverage-preserving mipmaps, 4-direction leaf coverage matching, Nanite Cluster DAG max-error hierarchy, and elevation impostor blending.
---

# Skill 03: Botanical Engine, World Scale & Cluster DAG LODs

## 1. Skeleton-vs-Mesh Decoupling (`ez-tree` × `solstice`)

Never run random number generation inside LOD meshing loops:
1. Call `generateBotanicalSkeleton(species)` (`runtime/core/botanicalSkeleton.ts`) once per `seed` and `species` (`knowledge/species-presets.json`: `fir`, `pine`, `oak`, `willow`, `bush`).
   - Uses **golden-angle spiral (`2.399963 rad`)** or **radial whorls** with crown envelopes (`cone`, `round`, `dome`, `pine-plates`, `bell-canopy`).
   - Automatically buries root bases (`-0.3 * heightMeters / 7.55`) so trees never float on terrain slopes.
2. Call `meshBotanicalSkeleton(skeleton, lodDetail)` deterministically across **LOD0–LOD3** with zero RNG divergence and shared `trunkCollider` (~28–32 triangles).

## 2. Foliage Shading & Coverage Preservation (`vegetation` × `threejs-nanites`)

1. **Kill Dark Undersides (`upNormalCards`)**:
   Never rely on `THREE.DoubleSide` on leaf cards (`DoubleSide` negates backface normals, turning sunlit tree crowns muddy black underneath). Use `buildUpNormalCard` / `meshBotanicalSkeleton` which emits paired opposing triangles both carrying upward crown-outward normals (`FrontSide`).
2. **Prevent Distance Canopy Vanishing (Coverage-Preserving Mipmaps)**:
   Standard linear box downsampling destroys cutout alpha foliage over distance. Always run `buildCoveragePreservingMipmaps()` (`runtime/core/shapedSurface.ts` or `forge_world/pbr_surface_synth.py mipmaps`) which uses 32-step binary search scaling + exact histogram equalization so every mip level preserves Level-0 projected area within `<= 0.2%`.
3. **Prevent Near/Far Canopy Popping (4-Direction Coverage Solver)**:
   When halving leaf card counts at coarser LODs, naive `sqrt(2)` card expansion explodes overhead leaf overlap. Run `solveAlphaCoverageScale(fullLeaves, coarseLeaves)` (`runtime/core/botanicalSkeleton.ts`) across Top + Side X + Side Z + Diagonal projections so every angle maintains true silhouette density.

## 3. World-Scale Instancing & Nanite Cluster DAGs (`solstice` × `threejs-nanites`)

When placing hundreds/thousands of instances or multi-million-triangle terrain/architecture meshes:
- Build Cluster DAGs via `buildClusterDagHierarchy()` (`runtime/core/clusterDag.ts`), propagating error strictly upward via `max(childError)` + geometric delta (`parentError > ownError` invariant).
- Evaluate screen-space pixel cut with `selectLodCut(nodes, cameraPos, projScalePx, 1.0)`.
- For distant LOD4 billboard impostors, pair `applyImpostorFadeShader()` (`runtime/three/createThreeSurface.ts`) with elevation/azimuth smoothstep blending and screen-space `fract(sin(...))` dither discard (no sorted transparency flickering!).

## 4. Weathered Rocks & World-Space Moss

Build rocks via `buildWeatheredRock(seed, radius, burialRatio=0.42, mossAmount)` (`runtime/core/geometryPrimitives.ts`):
- Always embed rock undersides (`burialRatio` ~ `0.35–0.50`) so boulders sit grounded in soil rather than perched like eggs.
- Drive moss placement strictly from **3D world-space upward normal + height** (`color` vertex weights + `Surface::shaped` cavity), never flat UV-space blobs.
