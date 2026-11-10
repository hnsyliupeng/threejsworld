/**
 * Multi-tier Botanical Three.js Builder fusing ez-tree + vegetation + solstice + threejs-nanites.
 * Builds deterministic LOD0..LOD3 + trunk collider from a single BotanicalSkeleton.
 */

import * as THREE from 'three';
import {
	generateBotanicalSkeleton,
	meshBotanicalSkeleton,
	type BotanicalSpecies,
} from '../core/botanicalSkeleton.ts';
import { buffersToThreeGeometry } from './createThreeSurface.ts';

export interface BotanicalBuildResult {
	lod: THREE.LOD;
	trunkCollider: THREE.BufferGeometry;
	triangleCounts: number[];
}

export function buildBotanicalAsset(
	species: BotanicalSpecies,
	barkMaterial: THREE.Material,
	leafMaterial: THREE.Material,
): BotanicalBuildResult {

	const skeleton = generateBotanicalSkeleton( species );
	const tiers = [
		{ dist: 0, detail: { sectionStride: 1, segmentFactor: 1.0, leafStride: 1, leafScale: 1.0 } },
		{ dist: 15, detail: { sectionStride: 2, segmentFactor: 0.75, leafStride: 2, leafScale: 1.32 } },
		{ dist: 35, detail: { sectionStride: 3, segmentFactor: 0.55, leafStride: 3, leafScale: 1.55 } },
		{ dist: 65, detail: { sectionStride: 4, segmentFactor: 0.45, leafStride: 5, leafScale: 1.85 } },
	];

	const lod = new THREE.LOD();
	const triangleCounts: number[] = [];
	let trunkCollider: THREE.BufferGeometry | null = null;

	for ( const tier of tiers ) {

		const built = meshBotanicalSkeleton( skeleton, tier.detail );
		if ( ! trunkCollider ) trunkCollider = buffersToThreeGeometry( built.trunkCollider );

		const group = new THREE.Group();
		const barkGeo = buffersToThreeGeometry( built.bark );
		const leafGeo = buffersToThreeGeometry( built.leaves );
		const barkMesh = new THREE.Mesh( barkGeo, barkMaterial );
		const leafMesh = new THREE.Mesh( leafGeo, leafMaterial );
		barkMesh.name = 'bark';
		leafMesh.name = 'leaves';
		barkMesh.castShadow = true;
		barkMesh.receiveShadow = true;
		leafMesh.castShadow = true;
		group.add( barkMesh, leafMesh );

		const tris = ( built.bark.indices.length + built.leaves.indices.length ) / 3;
		triangleCounts.push( tris );
		lod.addLevel( group, tier.dist );

	}

	return {
		lod,
		trunkCollider: trunkCollider!,
		triangleCounts,
	};

}
