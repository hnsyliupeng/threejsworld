/**
 * Native Node 22 TypeScript verification for ThreeJSWorld zero-DOM `runtime/core/` modules.
 * Execute with: node --experimental-strip-types tests/test_runtime.mjs
 */

import assert from 'node:assert/strict';
import {
  Mulberry32,
  periodicFbm2D,
  granitePresetSurface,
  computeAlphaCoverageRatio,
  buildCoveragePreservingMipmaps,
  buildTaperedSweep,
  buildVariableThicknessLoft,
  buildUpNormalCard,
  buildWeatheredRock,
  countDistinctZ,
  generateBotanicalSkeleton,
  meshBotanicalSkeleton,
  solveAlphaCoverageScale,
  buildClusterDagHierarchy,
  selectLodCut,
  generateRealisticTree,
  buildFlowerClump,
  buildGrassClump,
  synthesizeBarkSurface,
  synthesizeSoilSurface,
  synthesizeLeafSprigAtlas,
  synthesizeCarvedLimestoneSurface,
  synthesizeFlagstoneSlateSurface,
  synthesizeScholarRockSurface,
  synthesizeWaterNormalMap,
  planBotanicalGardenLayout,
  verifyGardenNonInterference,
  buildFlagstoneSlabGeometry,
  buildStoneFountainGeometry,
  buildFountainWaterStreamsGeometry,
  buildScholarRockMesh,
} from '../runtime/core/index.ts';

function assertOutwardWinding(name, mesh) {
  const { positions: p, indices: idx, normals: n } = mesh;
  assert.ok(idx.length >= 3 && idx.length % 3 === 0, `${name} must have valid triangle indices`);
  let neg = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const i0 = idx[k], i1 = idx[k + 1], i2 = idx[k + 2];
    const ax = p[i1 * 3] - p[i0 * 3], ay = p[i1 * 3 + 1] - p[i0 * 3 + 1], az = p[i1 * 3 + 2] - p[i0 * 3 + 2];
    const bx = p[i2 * 3] - p[i0 * 3], by = p[i2 * 3 + 1] - p[i0 * 3 + 1], bz = p[i2 * 3 + 2] - p[i0 * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const dot = cx * n[i0 * 3] + cy * n[i0 * 3 + 1] + cz * n[i0 * 3 + 2];
    if (dot < -1e-9) neg++;
  }
  assert.equal(neg, 0, `${name} had ${neg} inside-out triangles (faceNormal · vertNormal < 0)`);
}

// 1. Deterministic PRNG & Periodic Noise
{
  const a = new Mulberry32(1337);
  const b = new Mulberry32(1337);
  for (let i = 0; i < 20; i++) {
    assert.equal(a.next(), b.next(), 'Mulberry32 must be deterministic');
  }
  const n0 = periodicFbm2D(0.0, 0.35, 4, 3, 9);
  const n1 = periodicFbm2D(1.0, 0.35, 4, 3, 9);
  assert.ok(Math.abs(n0 - n1) < 1e-6, 'Periodic FBM must wrap seamlessly at u=0 / u=1');
}

// 2. Surface::shaped & Coverage-Preserving Alpha Mipmaps
{
  const surf = granitePresetSurface(64, 42, 0.3);
  assert.equal(surf.albedoSRGB.length, 64 * 64 * 4);
  assert.equal(surf.normalLinear.length, 64 * 64 * 4);
  assert.equal(surf.ormLinear.length, 64 * 64 * 4);

  // Leaf cutout circle alpha coverage check
  const size = 64;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - 32) / 22;
      const dy = (y - 32) / 22;
      const inside = dx * dx + dy * dy <= 1.0;
      const i = (y * size + x) * 4;
      rgba[i] = 60;
      rgba[i + 1] = 140;
      rgba[i + 2] = 50;
      rgba[i + 3] = inside ? 255 : 0;
    }
  }
  const mips = buildCoveragePreservingMipmaps(size, size, rgba, 0.45);
  const cov0 = mips[0].coverage;
  assert.ok(cov0 > 0.3 && cov0 < 0.5);
  for (const m of mips) {
    if (m.width >= 4) {
      assert.ok(Math.abs(m.coverage - cov0) < 0.025, `Mip ${m.width}x${m.height} drifted from ${cov0} to ${m.coverage}`);
    }
  }
  assert.ok(computeAlphaCoverageRatio(mips[0].data, 0.45) > 0.3);
}

// 3. Tapered Sweep (Parallel Transport) & Variable-Thickness Loft (distinctZ > 10)
{
  const sweep = buildTaperedSweep([
    { position: [0, 0, 0], rx: 0.1, rz: 0.1 },
    { position: [0.3, 0.5, 0.1], rx: 0.08, rz: 0.08 },
    { position: [-0.2, 1.0, 0.2], rx: 0.06, rz: 0.06 },
    { position: [0.1, 1.5, 0], rx: 0.03, rz: 0.03 },
  ], 10);
  assert.ok(sweep.positions.length > 0 && sweep.indices.length > 0);
  for (let i = 0; i < sweep.normals.length; i += 3) {
    const len = Math.hypot(sweep.normals[i], sweep.normals[i + 1], sweep.normals[i + 2]);
    assert.ok(Math.abs(len - 1) < 1e-4, 'Sweep normals must stay unit-length');
  }
  assertOutwardWinding('buildTaperedSweep', sweep);

  const outline = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    outline.push([Math.cos(t) * 0.4, Math.sin(t) * 0.6]);
  }
  const loft = buildVariableThicknessLoft(
    outline,
    (x, y) => 0.14 * Math.sqrt(Math.max(0.05, 1 - (x * x * 1.4 + y * y * 0.6))),
    11,
  );
  const dz = countDistinctZ(loft.positions, 3);
  assert.ok(dz > 10, `Variable-thickness loft must defeat distinctZ<=10 bias (got ${dz})`);
}

// 4. upNormalCard & Weathered Mossy Rock
{
  const card = buildUpNormalCard(0.5, 0.6, 0.88);
  assert.equal(card.indices.length, 12);
  for (let i = 1; i < card.normals.length; i += 3) {
    assert.ok(card.normals[i] > 0.8, 'Both front and back faces of upNormalCard must have upward +Y normals');
  }

  const rock = buildWeatheredRock(77, 1.0, 0.42, 0.35, 2);
  let minY = Infinity;
  for (let i = 1; i < rock.positions.length; i += 3) minY = Math.min(minY, rock.positions[i]);
  assert.ok(minY < -0.5, 'Weathered rock must bury its base below y=0');
  assertOutwardWinding('buildWeatheredRock', rock);
}

// 5. Botanical Skeleton/Mesh Decoupling + 4-Dir Coverage Solver
{
  const species = {
    heightMeters: 9.2,
    crownEnvelope: 'pine-plates',
    trunkRadius: 0.24,
    trunkFlare: 0.45,
    trunkGnarl: 0.04,
    mode: 'spiral',
    branchCount: 24,
    span: [0.35, 0.96],
    angleDeg: [58, 35],
    lengthRatio: 0.34,
    droop: 0.04,
    upturn: 0.14,
    leafSize: 0.72,
    seed: 101,
  };
  const skel = generateBotanicalSkeleton(species);
  const lod0a = meshBotanicalSkeleton(skel, { sectionStride: 1, leafStride: 1 });
  const lod0b = meshBotanicalSkeleton(skel, { sectionStride: 1, leafStride: 1 });
  assert.deepEqual(lod0a.bark.positions, lod0b.bark.positions, 'LOD meshing must be 100% RNG-free deterministic');
  assert.ok(lod0a.trunkCollider.indices.length >= 36, 'Shared trunkCollider must be built');

  let minTrunkY = Infinity;
  for (let i = 1; i < lod0a.trunkCollider.positions.length; i += 3) {
    minTrunkY = Math.min(minTrunkY, lod0a.trunkCollider.positions[i]);
  }
  assert.ok(minTrunkY < -0.1, `Trunk must embed beneath soil slope (minY=${minTrunkY})`);

  const coarseLeaves = skel.leaves.filter((_, idx) => idx % 2 === 0);
  const covScale = solveAlphaCoverageScale(skel.leaves, coarseLeaves);
  assert.ok(covScale >= 1.0 && covScale <= 2.5, `4-dir coverage scale out of bounds: ${covScale}`);
}

// 6. Nanite Cluster DAG Monotonic Error Propagation
{
  const leaves = Array.from({ length: 16 }, (_, i) => ({
    sphere: { center: [i * 2, 0, 0], radius: 1.0 },
    triangleCount: 128,
    localError: 0,
  }));
  const dag = buildClusterDagHierarchy(leaves, 4);
  for (const node of dag) {
    assert.ok(node.maxError <= node.parentError, `Cluster ${node.id} violated maxError <= parentError`);
  }
  const cutNear = selectLodCut(dag, [0, 0, 1], 1000, 1.0);
  const cutFar = selectLodCut(dag, [0, 0, 5000], 1000, 1.0);
  assert.ok(cutNear.length >= cutFar.length, 'Near camera should select finer/more cluster nodes than far camera');
}

// 7. Realistic Procedural Trees, Flowers & Grass (`botanicalFlora.ts`)
{
  for (const preset of ['oak', 'pine', 'birch']) {
    const treeA = generateRealisticTree({ preset, seed: 101 });
    const treeB = generateRealisticTree({ preset, seed: 101 });
    assert.deepEqual(treeA.bark.positions, treeB.bark.positions, `Tree ${preset} must be deterministic`);
    assertOutwardWinding(`tree.${preset}.bark`, treeA.bark);
    assert.ok(treeA.leafCount > 100, `Tree ${preset} must emit foliage cards`);
    for (let i = 0; i < treeA.leaves.normals.length; i += 3) {
      assert.ok(treeA.leaves.normals[i + 1] > 0.35, `Tree ${preset} leaves must preserve upward normal bias`);
    }
    let minY = Infinity;
    for (let i = 1; i < treeA.bark.positions.length; i += 3) minY = Math.min(minY, treeA.bark.positions[i]);
    assert.ok(minY < -0.1, `Tree ${preset} root collar must embed below y=0 (got ${minY})`);
  }

  for (const fPreset of ['daisy', 'rose', 'tulip']) {
    const fl = buildFlowerClump(fPreset, 21, 0.48);
    assertOutwardWinding(`flower.${fPreset}.stemsAndLeaves`, fl.stemsAndLeaves);
    assertOutwardWinding(`flower.${fPreset}.centerDisc`, fl.centerDisc);
    // Regression test: pinched petal/sepal claws & tips must NEVER produce zero-length normals
    for (const part of [fl.stemsAndLeaves, fl.petals, fl.centerDisc]) {
      for (let i = 0; i < part.normals.length; i += 3) {
        const l = Math.hypot(part.normals[i], part.normals[i + 1], part.normals[i + 2]);
        assert.ok(l > 0.9 && l < 1.1 && Number.isFinite(l), `Degenerate normal in ${fPreset} (len=${l})`);
      }
      for (let i = 0; i < part.positions.length; i++) {
        assert.ok(Number.isFinite(part.positions[i]), `Non-finite position in ${fPreset}`);
      }
    }
  }

  const fescue = buildGrassClump('fescue', 707, 24);
  const foxtail = buildGrassClump('foxtail', 707, 24);
  const sedge = buildGrassClump('sedge', 707, 24);
  for (const [name, g] of [['fescue', fescue], ['foxtail', foxtail], ['sedge', sedge]]) {
    assertOutwardWinding(`grass.${name}`, g);
    assert.ok(g.positions.length > 0 && g.indices.length > 0);
    for (let i = 0; i < g.normals.length; i += 3) {
      const l = Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]);
      assert.ok(l > 0.9 && l < 1.1, `Grass ${name} normal must be unit-length`);
    }
  }
  assert.ok(foxtail.indices.length > fescue.indices.length, 'Foxtail preset must add connected culm/panicle triangles');
}

// 8. Flora Surface::shaped Bark, Soil & Leaf Sprig Atlases (`floraTextures.ts`)
{
  for (const preset of ['oak', 'pine', 'birch']) {
    const bark = synthesizeBarkSurface(preset, 64, 42);
    assert.equal(bark.albedoSRGB.length, 64 * 64 * 4);
    assert.equal(bark.normalLinear.length, 64 * 64 * 4);
    assert.equal(bark.ormLinear.length, 64 * 64 * 4);

    const atlas = synthesizeLeafSprigAtlas(preset, 64, 0.45);
    assert.ok(atlas.albedoMips.length >= 6);
    const cov0 = atlas.albedoMips[0].coverage;
    assert.ok(cov0 > 0.15 && cov0 < 0.95, `Atlas ${preset} base coverage out of bounds: ${cov0}`);
    for (const m of atlas.albedoMips) {
      if (m.width >= 4) {
        assert.ok(Math.abs(m.coverage - cov0) < 0.05, `Atlas ${preset} mip ${m.width} coverage drifted (${m.coverage} vs ${cov0})`);
      }
    }
    // Verify transparent background pixels carry chlorophyll bleed (G > R, G > B, no black/white halo)
    const p0 = 0;
    assert.equal(atlas.albedoMips[0].data[p0 + 3], 0);
    assert.ok(atlas.albedoMips[0].data[p0 + 1] > atlas.albedoMips[0].data[p0], 'Transparent bleed must be chlorophyll green');
  }
  const soil = synthesizeSoilSurface(64, 77);
  assert.equal(soil.albedoSRGB.length, 64 * 64 * 4);
}

// 9. Photorealistic Lake Garden Layout, Non-Interference Solver & Stone/Water PBR (`gardenLayout.ts`)
{
  const plan = planBotanicalGardenLayout(2026);
  assert.ok(plan.flagstones.length >= 16, `Expected continuous flagstone path, got ${plan.flagstones.length}`);
  assert.ok(plan.rockeryStones.length >= 7, 'Expected multi-tier scholar rockery');
  assert.ok(plan.trees.length >= 4, 'Expected framing woodland trees');
  assert.ok(plan.flowers.length >= 25, 'Expected multi-bed garden flowers');
  assert.ok(plan.grassClumps.length >= 800, 'Expected dense collision-free turf');
  assert.ok(plan.lilyPads.length >= 10, 'Expected lake lily pads');

  const violations = verifyGardenNonInterference(plan);
  assert.deepEqual(violations, [], `Garden non-interference audit failed: ${violations.join('; ')}`);

  assertOutwardWinding('flagstoneSlab', buildFlagstoneSlabGeometry(0.32, 0.068, 500));
  const fnt = buildStoneFountainGeometry(40);
  assertOutwardWinding('stoneFountain', fnt.stone);
  const streams = buildFountainWaterStreamsGeometry(fnt.lowerPoolWaterY, fnt.upperPoolWaterY, fnt.nozzleTipY);
  assert.ok(streams.positions.length > 0 && streams.indices.length > 0);
  for (const st of plan.rockeryStones) {
    assertOutwardWinding(`scholarRock_${st.id}`, buildScholarRockMesh(st));
  }

  for (const surf of [
    synthesizeCarvedLimestoneSurface(64, 61),
    synthesizeFlagstoneSlateSurface(64, 83),
    synthesizeScholarRockSurface(64, 109),
  ]) {
    assert.equal(surf.albedoSRGB.length, 64 * 64 * 4);
    assert.equal(surf.normalLinear.length, 64 * 64 * 4);
    assert.equal(surf.ormLinear.length, 64 * 64 * 4);
  }
  const wNorm = synthesizeWaterNormalMap(64, 149);
  assert.equal(wNorm.length, 64 * 64 * 4);
}

console.log('ALL runtime/core TypeScript tests passed!');
