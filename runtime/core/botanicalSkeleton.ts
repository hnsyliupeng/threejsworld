/**
 * Fused Pure-Data Botanical Engine:
 *  - ez-tree: Skeleton (RNG) vs Mesh (RNG-free LOD) decoupling
 *  - solstice: golden-angle (2.399963 rad) spiral & whorl stem grammar + crown envelope
 *  - vegetation: ground root embedding (-0.3m * h/7.55), upNormalCards, trunk collider
 *  - threejs-nanites: 4-direction CPU alpha-mask coverage solver (replaces naive sqrt(2) expansion)
 */

import { Mulberry32 } from './prng.ts';
import type { MeshBuffers } from './geometryPrimitives.ts';

const GOLDEN_ANGLE = 2.399963229728653;

export interface BotanicalSpecies {
	heightMeters: number;
	crownEnvelope: 'cone' | 'round' | 'dome' | 'pine-plates' | 'bell-canopy';
	trunkRadius: number;
	trunkFlare: number;
	trunkGnarl: number;
	mode: 'whorl' | 'spiral';
	whorlCount?: number;
	branchCount: number;
	span: [ number, number ];
	angleDeg: [ number, number ];
	lengthRatio: number;
	droop: number;
	upturn: number;
	leafSize: number;
	seed: number;
}

export interface SkeletonNode {
	points: Array<[ number, number, number ]>;
	radii: number[];
	level: number;
}

export interface LeafAnchor {
	position: [ number, number, number ];
	direction: [ number, number, number ];
	size: number;
}

export interface BotanicalSkeleton {
	species: BotanicalSpecies;
	stems: SkeletonNode[];
	leaves: LeafAnchor[];
}

export interface BotanicalLodDetail {
	sectionStride?: number;
	segmentFactor?: number;
	leafStride?: number;
	leafScale?: number;
}

function envelopeAt( kind: BotanicalSpecies[ 'crownEnvelope' ], t: number ): number {

	if ( kind === 'cone' ) return Math.max( 0.15, 1.0 - t * 0.85 );
	if ( kind === 'dome' ) return Math.sin( Math.min( 1, t * 0.85 + 0.15 ) * Math.PI * 0.5 );
	if ( kind === 'pine-plates' ) return 0.45 + 0.55 * Math.sin( t * Math.PI );
	return Math.sin( ( 0.12 + 0.88 * t ) * Math.PI );

}

export function generateBotanicalSkeleton( species: BotanicalSpecies ): BotanicalSkeleton {

	const rng = new Mulberry32( species.seed );
	const embedY = - 0.3 * ( species.heightMeters / 7.55 ); // vegetation terrain-slope fix
	const trunkSegs = 8;
	const trunkPts: Array<[ number, number, number ]> = [];
	const trunkRads: number[] = [];

	let px = 0;
	let py = embedY;
	let pz = 0;
	const totalTrunkH = species.heightMeters - embedY;
	for ( let i = 0; i <= trunkSegs; i ++ ) {

		const t = i / trunkSegs;
		trunkPts.push( [ px, py, pz ] );
		const flare = t < 0.18 ? ( 1 + species.trunkFlare * ( 1 - t / 0.18 ) ) : 1;
		trunkRads.push( Math.max( 0.015, species.trunkRadius * flare * ( 1 - 0.78 * t ) ) );
		px += rng.signed() * species.trunkGnarl * species.heightMeters * 0.25;
		pz += rng.signed() * species.trunkGnarl * species.heightMeters * 0.25;
		py = embedY + totalTrunkH * ( ( i + 1 ) / trunkSegs );

	}

	const stems: SkeletonNode[] = [ { points: trunkPts, radii: trunkRads, level: 0 } ];
	const leaves: LeafAnchor[] = [];
	const [ s0, s1 ] = species.span;

	for ( let b = 0; b < species.branchCount; b ++ ) {

		const u = species.branchCount > 1 ? b / ( species.branchCount - 1 ) : 0.5;
		const alongTrunk = s0 + ( s1 - s0 ) * u;
		const idxF = alongTrunk * trunkSegs;
		const idx0 = Math.min( trunkSegs - 1, Math.floor( idxF ) );
		const frac = idxF - idx0;
		const bx = trunkPts[ idx0 ]![ 0 ] + ( trunkPts[ idx0 + 1 ]![ 0 ] - trunkPts[ idx0 ]![ 0 ] ) * frac;
		const by = trunkPts[ idx0 ]![ 1 ] + ( trunkPts[ idx0 + 1 ]![ 1 ] - trunkPts[ idx0 ]![ 1 ] ) * frac;
		const bz = trunkPts[ idx0 ]![ 2 ] + ( trunkPts[ idx0 + 1 ]![ 2 ] - trunkPts[ idx0 ]![ 2 ] ) * frac;
		const bRad = ( trunkRads[ idx0 ]! + ( trunkRads[ idx0 + 1 ]! - trunkRads[ idx0 ]! ) * frac ) * 0.55;

		const azimuth = species.mode === 'whorl'
			? ( b % ( species.whorlCount || 5 ) ) * ( ( Math.PI * 2 ) / ( species.whorlCount || 5 ) ) + Math.floor( b / ( species.whorlCount || 5 ) ) * 0.65
			: b * GOLDEN_ANGLE;

		const angleRad = ( ( species.angleDeg[ 0 ] + ( species.angleDeg[ 1 ] - species.angleDeg[ 0 ] ) * u ) * Math.PI ) / 180;
		const branchLen = species.heightMeters * species.lengthRatio * envelopeAt( species.crownEnvelope, u ) * rng.range( 0.85, 1.15 );

		const bSegs = 4;
		const bPts: Array<[ number, number, number ]> = [];
		const bRads: number[] = [];
		let dx = Math.sin( angleRad ) * Math.cos( azimuth );
		let dy = Math.cos( angleRad );
		let dz = Math.sin( angleRad ) * Math.sin( azimuth );
		let cx = bx;
		let cy = by;
		let cz = bz;

		for ( let s = 0; s <= bSegs; s ++ ) {

			const bt = s / bSegs;
			bPts.push( [ cx, cy, cz ] );
			bRads.push( Math.max( 0.008, bRad * ( 1 - 0.85 * bt ) ) );
			if ( s > 0 ) {

				leaves.push( {
					position: [ cx, cy, cz ],
					direction: [ dx, Math.max( 0.25, dy + 0.3 ), dz ],
					size: species.leafSize * rng.range( 0.8, 1.2 ),
				} );

			}
			const step = branchLen / bSegs;
			dy += ( species.upturn - species.droop * bt ) * step;
			const dl = Math.hypot( dx, dy, dz ) || 1;
			dx /= dl;
			dy /= dl;
			dz /= dl;
			cx += dx * step;
			cy += dy * step;
			cz += dz * step;

		}
		stems.push( { points: bPts, radii: bRads, level: 1 } );

	}

	return { species, stems, leaves };

}

/**
 * RNG-free deterministic LOD meshing from a fixed skeleton (ez-tree contract).
 */
export function meshBotanicalSkeleton(
	skeleton: BotanicalSkeleton,
	detail: BotanicalLodDetail = {},
): { bark: MeshBuffers; leaves: MeshBuffers; trunkCollider: MeshBuffers } {

	const sectionStride = Math.max( 1, Math.floor( detail.sectionStride ?? 1 ) );
	const segFactor = detail.segmentFactor ?? 1.0;
	const leafStride = Math.max( 1, Math.floor( detail.leafStride ?? 1 ) );
	const leafScale = detail.leafScale ?? 1.0;

	const bPos: number[] = [];
	const bNrm: number[] = [];
	const bUv: number[] = [];
	const bIdx: number[] = [];
	const maxH = Math.max( 0.5, skeleton.species.heightMeters );

	for ( const stem of skeleton.stems ) {

		const radialSegs = Math.max( 3, Math.round( ( stem.level === 0 ? 7 : 5 ) * segFactor ) );
		const sampledIdx: number[] = [];
		for ( let i = 0; i < stem.points.length; i += sectionStride ) sampledIdx.push( i );
		if ( sampledIdx[ sampledIdx.length - 1 ] !== stem.points.length - 1 ) sampledIdx.push( stem.points.length - 1 );

		const baseVert = bPos.length / 3;
		const ringStride = radialSegs + 1;
		for ( let ri = 0; ri < sampledIdx.length; ri ++ ) {

			const p = stem.points[ sampledIdx[ ri ]! ]!;
			const rad = stem.radii[ sampledIdx[ ri ]! ]!;
			const vCoord = ri / Math.max( 1, sampledIdx.length - 1 );
			for ( let j = 0; j <= radialSegs; j ++ ) {

				const theta = ( j / radialSegs ) * Math.PI * 2;
				const nx = Math.cos( theta );
				const nz = Math.sin( theta );
				bPos.push( p[ 0 ] + nx * rad, p[ 1 ], p[ 2 ] + nz * rad );
				bNrm.push( nx, 0.15, nz );
				bUv.push( j / radialSegs, vCoord );

			}

		}
		for ( let ri = 0; ri < sampledIdx.length - 1; ri ++ ) {

			for ( let j = 0; j < radialSegs; j ++ ) {

				const a = baseVert + ri * ringStride + j;
				const b = a + 1;
				const c = a + ringStride;
				const d = c + 1;
				bIdx.push( a, c, b, b, c, d );

			}

		}

	}

	// Leaves as upNormalCards (double triangles with upward crown-outward normals, FrontSide safe)
	const lPos: number[] = [];
	const lNrm: number[] = [];
	const lUv: number[] = [];
	const lWind: number[] = [];
	const lIdx: number[] = [];

	for ( let i = 0; i < skeleton.leaves.length; i += leafStride ) {

		const leaf = skeleton.leaves[ i ]!;
		const sz = leaf.size * leafScale * 0.5;
		const [ x, y, z ] = leaf.position;
		const baseV = lPos.length / 3;
		const wind = Math.max( 0, Math.min( 1, y / maxH ) );

		const nLen = Math.hypot( leaf.direction[ 0 ], leaf.direction[ 1 ] + 0.5, leaf.direction[ 2 ] ) || 1;
		const nx = leaf.direction[ 0 ] / nLen;
		const ny = ( leaf.direction[ 1 ] + 0.5 ) / nLen;
		const nz = leaf.direction[ 2 ] / nLen;

		const corners: Array<[ number, number, number, number, number ]> = [
			[ x - sz, y - sz * 0.3, z, 0, 0 ],
			[ x + sz, y - sz * 0.3, z, 1, 0 ],
			[ x + sz, y + sz * 1.4, z, 1, 1 ],
			[ x - sz, y + sz * 1.4, z, 0, 1 ],
		];
		for ( let side = 0; side < 2; side ++ ) {

			for ( const [ cx, cy, cz, u, v ] of corners ) {

				lPos.push( cx, cy, cz );
				lNrm.push( nx, ny, nz ); // Both sides keep sky/crown-outward normal
				lUv.push( u, v );
				lWind.push( wind );

			}

		}
		lIdx.push(
			baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3,
			baseV + 4, baseV + 6, baseV + 5, baseV + 4, baseV + 7, baseV + 6,
		);

	}

	// Trunk-only collider cylinder (~28-32 tris, extending down by ground embed)
	const trunk = skeleton.stems[ 0 ]!;
	const cSegs = 6;
	const cPos: number[] = [];
	const cNrm: number[] = [];
	const cUv: number[] = [];
	const cIdx: number[] = [];
	const pBot = trunk.points[ 0 ]!;
	const pTop = trunk.points[ trunk.points.length - 1 ]!;
	const rBot = trunk.radii[ 0 ]!;
	const rTop = trunk.radii[ trunk.radii.length - 1 ]!;
	for ( let r = 0; r < 2; r ++ ) {

		const p = r === 0 ? pBot : pTop;
		const rad = r === 0 ? rBot : rTop;
		for ( let j = 0; j <= cSegs; j ++ ) {

			const th = ( j / cSegs ) * Math.PI * 2;
			cPos.push( p[ 0 ] + Math.cos( th ) * rad, p[ 1 ], p[ 2 ] + Math.sin( th ) * rad );
			cNrm.push( Math.cos( th ), 0, Math.sin( th ) );
			cUv.push( j / cSegs, r );

		}

	}
	for ( let j = 0; j < cSegs; j ++ ) {

		const a = j;
		const b = j + 1;
		const c = cSegs + 1 + j;
		const d = c + 1;
		cIdx.push( a, c, b, b, c, d );

	}

	return {
		bark: {
			positions: new Float32Array( bPos ),
			normals: new Float32Array( bNrm ),
			uvs: new Float32Array( bUv ),
			indices: new Uint32Array( bIdx ),
		},
		leaves: {
			positions: new Float32Array( lPos ),
			normals: new Float32Array( lNrm ),
			uvs: new Float32Array( lUv ),
			windWeights: new Float32Array( lWind ),
			indices: new Uint32Array( lIdx ),
		},
		trunkCollider: {
			positions: new Float32Array( cPos ),
			normals: new Float32Array( cNrm ),
			uvs: new Float32Array( cUv ),
			indices: new Uint32Array( cIdx ),
		},
	};

}

/**
 * 4-direction CPU coverage solver (threejs-nanites `dag/coverage.ts` algorithm).
 * Solves for exact scale multiplier so halved leaf cards preserve projected opaque coverage
 * instead of exploding canopy area via naive sqrt(2).
 */
export function solveAlphaCoverageScale(
	fullLeaves: LeafAnchor[],
	coarseLeaves: LeafAnchor[],
	gridRes = 48,
): number {

	if ( coarseLeaves.length === 0 || fullLeaves.length === 0 ) return 1.0;

	const dirs: Array<[ [ number, number, number ], [ number, number, number ] ]> = [
		[ [ 1, 0, 0 ], [ 0, 0, 1 ] ], // Top view
		[ [ 0, 0, 1 ], [ 0, 1, 0 ] ], // Side X
		[ [ 1, 0, 0 ], [ 0, 1, 0 ] ], // Side Z
		[ [ 0.707, 0, - 0.707 ], [ - 0.408, 0.816, - 0.408 ] ], // Diagonal
	];

	let minX = Infinity;
	let maxX = - Infinity;
	let minY = Infinity;
	let maxY = - Infinity;
	for ( const l of fullLeaves ) {

		minX = Math.min( minX, l.position[ 0 ] - l.size );
		maxX = Math.max( maxX, l.position[ 0 ] + l.size );
		minY = Math.min( minY, l.position[ 1 ] - l.size );
		maxY = Math.max( maxY, l.position[ 1 ] + l.size );

	}
	const span = Math.max( 1.0, maxX - minX, maxY - minY ) * 1.4;
	const grid = new Uint8Array( gridRes * gridRes );

	const countProjected = ( leaves: LeafAnchor[], scale: number ): number => {

		let total = 0;
		for ( const [ uAxis, vAxis ] of dirs ) {

			grid.fill( 0 );
			for ( const lf of leaves ) {

				const u = lf.position[ 0 ] * uAxis[ 0 ] + lf.position[ 1 ] * uAxis[ 1 ] + lf.position[ 2 ] * uAxis[ 2 ];
				const v = lf.position[ 0 ] * vAxis[ 0 ] + lf.position[ 1 ] * vAxis[ 1 ] + lf.position[ 2 ] * vAxis[ 2 ];
				const half = Math.max( 1, Math.round( ( ( lf.size * scale * 0.5 ) / span ) * gridRes ) );
				const cx = Math.floor( ( ( u / span ) + 0.5 ) * gridRes );
				const cy = Math.floor( ( ( v / span ) + 0.5 ) * gridRes );
				for ( let dy = - half; dy <= half; dy ++ ) {

					const gy = cy + dy;
					if ( gy < 0 || gy >= gridRes ) continue;
					for ( let dx = - half; dx <= half; dx ++ ) {

						const gx = cx + dx;
						if ( gx < 0 || gx >= gridRes ) continue;
						grid[ gy * gridRes + gx ] = 1;

					}

				}

			}
			for ( let k = 0; k < grid.length; k ++ ) total += grid[ k ]!;

		}
		return total;

	};

	const target = countProjected( fullLeaves, 1.0 );
	let lo = 1.0;
	let hi = 2.5;
	for ( let iter = 0; iter < 16; iter ++ ) {

		const mid = 0.5 * ( lo + hi );
		const cov = countProjected( coarseLeaves, mid );
		if ( cov < target ) lo = mid;
		else hi = mid;

	}
	return 0.5 * ( lo + hi );

}
