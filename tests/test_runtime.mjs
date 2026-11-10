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
} from '../runtime/core/index.ts';

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

console.log('ALL runtime/core TypeScript tests passed!');
