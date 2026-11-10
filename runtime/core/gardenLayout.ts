/**
 * Pure-data Photorealistic Botanical Lake Garden Layout, Terrain Heightfield,
 * Spatial Non-Interference Solver (Zero Overlap Invariants), Carved Stone Fountain,
 * Winding Flagstone Path, Layered PBR Rockery (假山), and Shoreline Water Geometry.
 *
 * Zero DOM / Zero Three.js dependencies.
 */

import { Mulberry32, periodicFbm2D } from './prng.ts';
import type { MeshBuffers } from './geometryPrimitives.ts';
import { buildWeatheredRock } from './geometryPrimitives.ts';

export interface CircleCollider2D {
	id: string;
	kind: 'tree' | 'rockery' | 'fountain' | 'flagstone' | 'flower' | 'grass' | 'reed';
	x: number;
	z: number;
	radius: number;
}

export interface FlagstoneSpec {
	id: string;
	cx: number;
	cz: number;
	y: number;
	radius: number;
	yaw: number;
	tiltX: number;
	tiltZ: number;
	seed: number;
}

export interface RockeryStoneSpec {
	id: string;
	x: number;
	y: number;
	z: number;
	rx: number;
	ry: number;
	rz: number;
	yaw: number;
	seed: number;
	mossCoverage: number;
	detail: number;
	tier: 'base' | 'mid' | 'peak' | 'accent';
}

export interface TreePlacementSpec {
	id: string;
	preset: 'oak' | 'pine' | 'birch';
	x: number;
	y: number;
	z: number;
	trunkClearanceRadius: number;
	heightScale: number;
	seed: number;
}

export interface FlowerPlacementSpec {
	id: string;
	preset: 'daisy' | 'rose' | 'tulip';
	x: number;
	y: number;
	z: number;
	heightMeters: number;
	seed: number;
	radius: number;
}

export interface GrassPlacementSpec {
	id: string;
	preset: 'fescue' | 'foxtail' | 'sedge';
	x: number;
	y: number;
	z: number;
	scale: number;
	yaw: number;
	radius: number;
}

export interface LilyPadSpec {
	x: number;
	z: number;
	radius: number;
	hasBloom: boolean;
	yaw: number;
}

export interface GardenLayoutPlan {
	waterLevel: number;
	lakeCenter: [ number, number ];
	fountainPos: [ number, number, number ];
	fountainOuterRadius: number;
	rockeryCenter: [ number, number ];
	rockeryFootprintRadius: number;
	pathSpine: Array<[ number, number ]>;
	flagstones: FlagstoneSpec[];
	rockeryStones: RockeryStoneSpec[];
	shoreBoulders: RockeryStoneSpec[];
	trees: TreePlacementSpec[];
	flowers: FlowerPlacementSpec[];
	grassClumps: GrassPlacementSpec[];
	lilyPads: LilyPadSpec[];
	reeds: Array<{ x: number; y: number; z: number; scale: number; yaw: number }>;
	colliders: CircleCollider2D[];
}

export const WATER_LEVEL = - 0.08;
export const LAKE_CENTER: [ number, number ] = [ 2.05, - 0.30 ];
export const FOUNTAIN_CENTER: [ number, number ] = [ 2.40, - 0.35 ];
export const FOUNTAIN_OUTER_RADIUS = 0.94;
export const ROCKERY_CENTER: [ number, number ] = [ - 4.10, - 1.55 ];
export const ROCKERY_FOOTPRINT_RADIUS = 1.90;

/**
 * Signed distance to the organic kidney-shaped lake shoreline.
 * Negative = inside water, 0 = shoreline edge, Positive = dry land.
 */
export function lakeSignedDistance( x: number, z: number ): number {

	const lx = x - LAKE_CENTER[ 0 ];
	const lz = z - LAKE_CENTER[ 1 ];
	// Rotate -12 deg so the long axis frames hero camera harmoniously
	const ca = Math.cos( - 0.21 );
	const sa = Math.sin( - 0.21 );
	const rx = lx * ca - lz * sa;
	const rz = lx * sa + lz * ca;

	const ang = Math.atan2( rz, rx );
	// Organic meandering lake shoreline (bay + peninsula lobes, never a geometric oval)
	const indent = - 0.58 * Math.exp( - Math.pow( ( ang - 2.35 ) / 0.65, 2 ) )
		+ 0.42 * Math.sin( ang * 2.0 + 0.6 )
		+ 0.24 * Math.cos( ang * 3.0 - 0.9 )
		+ 0.14 * Math.sin( ang * 5.0 + 1.2 );
	const ax = 3.35 + indent;
	const az = 2.45 + indent * 0.72;

	const normR = Math.hypot( rx / ax, rz / az );
	// Approximate metric signed distance scaled by harmonic mean radius
	return ( normR - 1.0 ) * 2.65;

}

const PATH_CONTROL_POINTS: Array<[ number, number ]> = [
	[ - 2.95, 5.45 ],
	[ - 1.55, 3.85 ],
	[ - 0.85, 2.55 ],
	[ - 1.85, 1.05 ],
	[ - 2.05, - 0.85 ],
	[ - 1.35, - 2.75 ],
	[ 0.55, - 3.95 ],
	[ 3.10, - 4.45 ],
];

function evalCatmullRom2D( pts: Array<[ number, number ]>, tGlobal: number ): [ number, number ] {

	const n = pts.length - 1;
	const scaled = Math.max( 0, Math.min( n - 1e-6, tGlobal * n ) );
	const i = Math.floor( scaled );
	const t = scaled - i;
	const p0 = pts[ Math.max( 0, i - 1 ) ]!;
	const p1 = pts[ i ]!;
	const p2 = pts[ Math.min( n, i + 1 ) ]!;
	const p3 = pts[ Math.min( n, i + 2 ) ]!;

	const t2 = t * t;
	const t3 = t2 * t;
	const x = 0.5 * (
		( 2 * p1[ 0 ] ) +
		( - p0[ 0 ] + p2[ 0 ] ) * t +
		( 2 * p0[ 0 ] - 5 * p1[ 0 ] + 4 * p2[ 0 ] - p3[ 0 ] ) * t2 +
		( - p0[ 0 ] + 3 * p1[ 0 ] - 3 * p2[ 0 ] + p3[ 0 ] ) * t3
	);
	const z = 0.5 * (
		( 2 * p1[ 1 ] ) +
		( - p0[ 1 ] + p2[ 1 ] ) * t +
		( 2 * p0[ 1 ] - 5 * p1[ 1 ] + 4 * p2[ 1 ] - p3[ 1 ] ) * t2 +
		( - p0[ 1 ] + 3 * p1[ 1 ] - 3 * p2[ 1 ] + p3[ 1 ] ) * t3
	);
	return [ x, z ];

}

export function samplePathSpine( samples = 96 ): Array<[ number, number ]> {

	const out: Array<[ number, number ]> = [];
	for ( let i = 0; i <= samples; i ++ ) {

		out.push( evalCatmullRom2D( PATH_CONTROL_POINTS, i / samples ) );

	}
	return out;

}

const DENSE_SPINE = samplePathSpine( 120 );

export function distanceToPathSpine( x: number, z: number ): number {

	let minD = Infinity;
	for ( const p of DENSE_SPINE ) {

		const d = Math.hypot( x - p[ 0 ], z - p[ 1 ] );
		if ( d < minD ) minD = d;

	}
	return minD;

}

/**
 * Unified terrain elevation field (metres).
 * - Deep sculpted lake basin down to -0.78m inside lakeSDF < 0
 * - Flat groomed path bed & clearing around y = 0.02..0.06
 * - Gentle natural berm mound under the NW rockery (+0.26m)
 * - Outer rolling parklands beyond r > 7m
 */
export function sampleGardenTerrainHeight( x: number, z: number ): number {

	const lsd = lakeSignedDistance( x, z );
	let lakeCarve = 0;
	if ( lsd < 0.55 ) {

		// Smooth cosine bowl from +0.02 shoreline bank down to -0.78m lake floor
		const t = Math.max( 0, Math.min( 1, ( 0.55 - lsd ) / 2.15 ) );
		const smooth = t * t * ( 3 - 2 * t );
		lakeCarve = - 0.80 * smooth;

	}

	// Subtle mound under the NW rockery (假山基座土丘)
	const dRock = Math.hypot( x - ROCKERY_CENTER[ 0 ], z - ROCKERY_CENTER[ 1 ] );
	const rockMound = dRock < 3.0
		? 0.24 * Math.pow( Math.max( 0, Math.cos( ( dRock / 3.0 ) * Math.PI * 0.5 ) ), 1.4 )
		: 0;

	// Outer rolling lawn hill outside main courtyard (suppress inside lake/path)
	const r = Math.hypot( x, z );
	const outerFactor = Math.min( 1, Math.max( 0, ( r - 6.8 ) / 7.5 ) );
	const microRelief = ( periodicFbm2D( ( x + 30 ) / 20, ( z + 30 ) / 20, 4, 3, 19 ) - 0.5 ) * 0.10;
	const rolling = ( Math.sin( x * 0.18 ) * Math.cos( z * 0.16 ) * 0.65 + 0.18 ) * outerFactor;

	return lakeCarve + rockMound + rolling + microRelief * ( lsd > 0.3 ? 1 : 0.2 );

}

export function sampleGardenTerrainNormal( x: number, z: number ): [ number, number, number ] {

	const eps = 0.08;
	const hx0 = sampleGardenTerrainHeight( x - eps, z );
	const hx1 = sampleGardenTerrainHeight( x + eps, z );
	const hz0 = sampleGardenTerrainHeight( x, z - eps );
	const hz1 = sampleGardenTerrainHeight( x, z + eps );
	const nx = hx0 - hx1;
	const ny = 2 * eps;
	const nz = hz0 - hz1;
	const len = Math.hypot( nx, ny, nz ) || 1;
	return [ nx / len, ny / len, nz / len ];

}

/**
 * Generates an organic multi-faceted bluestone/slate flagstone slab mesh
 * with beveled top edge and embedded bottom skirt (outward winding verified).
 */
export function buildFlagstoneSlabGeometry( radius: number, thickness: number, seed: number ): MeshBuffers {

	const rng = new Mulberry32( seed );
	const sides = 8;
	const radii: number[] = [];
	for ( let i = 0; i < sides; i ++ ) {

		radii.push( radius * rng.range( 0.80, 1.06 ) );

	}

	const pos: number[] = [];
	const nrm: number[] = [];
	const uv: number[] = [];
	const col: number[] = [];
	const idx: number[] = [];

	// 4 vertical rings: bottom skirt (-0.045), mid side (0.0), bevel edge (thickness*0.82), flat top inner (thickness)
	const ringHeights = [ - 0.045, 0.0, thickness * 0.78, thickness ];
	const ringScales = [ 1.04, 1.0, 0.96, 0.88 ];
	const ringColors: Array<[ number, number, number ]> = [
		[ 0.56, 0.56, 0.54 ],
		[ 0.72, 0.72, 0.70 ],
		[ 0.90, 0.90, 0.88 ],
		[ 0.98, 0.98, 0.96 ],
	];

	const stride = sides + 1;
	for ( let r = 0; r < ringHeights.length; r ++ ) {

		const y = ringHeights[ r ]!;
		const sc = ringScales[ r ]!;
		const rc = ringColors[ r ]!;
		for ( let s = 0; s <= sides; s ++ ) {

			const k = s % sides;
			const th = ( k / sides ) * Math.PI * 2;
			const rad = radii[ k ]! * sc;
			const x = Math.cos( th ) * rad;
			const z = Math.sin( th ) * rad;
			const topJitter = r >= 2 ? ( rng.signed() * 0.002 ) : 0;

			pos.push( x, y + topJitter, z );
			if ( r === 3 ) {

				nrm.push( 0, 1, 0 );

			} else if ( r === 2 ) {

				const l = Math.hypot( Math.cos( th ) * 0.65, 0.76, Math.sin( th ) * 0.65 );
				nrm.push( ( Math.cos( th ) * 0.65 ) / l, 0.76 / l, ( Math.sin( th ) * 0.65 ) / l );

			} else {

				nrm.push( Math.cos( th ), 0.1, Math.sin( th ) );

			}
			uv.push( 0.5 + x / ( radius * 2.2 ), 0.5 + z / ( radius * 2.2 ) );
			col.push( rc[ 0 ], rc[ 1 ], rc[ 2 ] );

		}

	}

	// Side & bevel quads — outward CCW winding
	for ( let r = 0; r < ringHeights.length - 1; r ++ ) {

		for ( let s = 0; s < sides; s ++ ) {

			const a = r * stride + s;
			const b = a + 1;
			const c = ( r + 1 ) * stride + s;
			const d = c + 1;
			// Outward-facing: (a->c) is +Y, (a->b) is +theta (+X to +Z -> -Y cross!) -> (a, c, b, b, c, d)
			idx.push( a, c, b, b, c, d );

		}

	}

	// Flat top center vertex + fan (outward +Y)
	const topCenterIdx = pos.length / 3;
	pos.push( 0, thickness, 0 );
	nrm.push( 0, 1, 0 );
	uv.push( 0.5, 0.5 );
	col.push( 1.0, 1.0, 1.0 );
	const topRingBase = 3 * stride;
	for ( let s = 0; s < sides; s ++ ) {

		const a = topRingBase + s;
		const b = a + 1;
		// Top fan: center -> b -> a points +Y up
		idx.push( topCenterIdx, b, a );

	}

	return {
		positions: new Float32Array( pos ),
		normals: new Float32Array( nrm ),
		uvs: new Float32Array( uv ),
		colors: new Float32Array( col ),
		indices: new Uint32Array( idx ),
	};

}

/**
 * Generates an architectural 2-tier carved stone fountain (lathe revolution with exact analytical outward normals):
 * - Submerged pedestal foundation anchored on lake floor
 * - Main outer circular pool basin + moulded bullnose rim
 * - Fluted central pedestal + upper saucer bowl + top spire nozzle
 */
export function buildStoneFountainGeometry( radialSegs = 40 ): {
	stone: MeshBuffers;
	upperPoolWaterY: number;
	lowerPoolWaterY: number;
	nozzleTipY: number;
} {

	// Profile points [radius, y] traced from outer base UP -> over rim -> down inside basin -> pedestal -> upper saucer -> finial tip
	const profile: Array<[ number, number, number ]> = [
		// [r, y, shade]
		[ 0.88, - 0.85, 0.62 ],
		[ 0.92, - 0.12, 0.68 ],
		[ 0.90, 0.04, 0.78 ],
		[ 0.94, 0.22, 0.90 ],
		[ 0.96, 0.28, 0.98 ],
		[ 0.92, 0.33, 1.00 ],
		[ 0.82, 0.33, 0.98 ],
		[ 0.78, 0.28, 0.88 ],
		[ 0.75, 0.10, 0.76 ],
		[ 0.30, 0.10, 0.76 ],
		// Central baluster pedestal
		[ 0.28, 0.26, 0.86 ],
		[ 0.17, 0.48, 0.92 ],
		[ 0.22, 0.72, 0.95 ],
		[ 0.14, 0.88, 0.92 ],
		// Upper saucer bowl
		[ 0.42, 0.96, 0.94 ],
		[ 0.50, 1.05, 0.98 ],
		[ 0.48, 1.10, 1.00 ],
		[ 0.42, 1.10, 0.98 ],
		[ 0.38, 1.02, 0.86 ],
		[ 0.12, 1.02, 0.84 ],
		// Upper nozzle finial
		[ 0.11, 1.24, 0.94 ],
		[ 0.15, 1.32, 0.98 ],
		[ 0.08, 1.44, 1.00 ],
		[ 0.04, 1.56, 1.00 ],
		[ 0.002, 1.58, 1.00 ],
	];

	const nProf = profile.length;
	const stride = radialSegs + 1;
	const pos: number[] = [];
	const nrm: number[] = [];
	const uv: number[] = [];
	const col: number[] = [];
	const idx: number[] = [];

	// Compute cumulative arc length for seamless V UV mapping
	const arcLen: number[] = [ 0 ];
	for ( let i = 1; i < nProf; i ++ ) {

		const dr = profile[ i ]![ 0 ] - profile[ i - 1 ]![ 0 ];
		const dy = profile[ i ]![ 1 ] - profile[ i - 1 ]![ 1 ];
		arcLen.push( arcLen[ i - 1 ]! + Math.hypot( dr, dy ) );

	}

	for ( let i = 0; i < nProf; i ++ ) {

		const p = profile[ i ]!;
		const pPrev = profile[ Math.max( 0, i - 1 ) ]!;
		const pNext = profile[ Math.min( nProf - 1, i + 1 ) ]!;
		// 2D tangent along profile (dr, dy) -> outward radial-normal is (+dy, -dr)
		const dr = pNext[ 0 ] - pPrev[ 0 ];
		const dy = pNext[ 1 ] - pPrev[ 1 ];
		const nrRaw = dy;
		const nyRaw = - dr;
		const nl = Math.hypot( nrRaw, nyRaw ) || 1;
		const nr = nrRaw / nl;
		const ny = nyRaw / nl;

		const v = arcLen[ i ]! * 0.85;
		const shade = p[ 2 ];

		for ( let s = 0; s <= radialSegs; s ++ ) {

			const u = s / radialSegs;
			const th = u * Math.PI * 2;
			const ct = Math.cos( th );
			const st = Math.sin( th );

			pos.push( ct * p[ 0 ], p[ 1 ], st * p[ 0 ] );
			nrm.push( ct * nr, ny, st * nr );
			uv.push( u * 2.0, v );
			col.push( shade, shade * 0.99, shade * 0.96 );

		}

	}

	for ( let i = 0; i < nProf - 1; i ++ ) {

		for ( let s = 0; s < radialSegs; s ++ ) {

			const a = i * stride + s;
			const b = a + 1;
			const c = ( i + 1 ) * stride + s;
			const d = c + 1;
			// Profile goes upward, th goes +X -> +Z, outward normal is (+dy, -dr) => (a, c, b, b, c, d)
			idx.push( a, c, b, b, c, d );

		}

	}

	return {
		stone: {
			positions: new Float32Array( pos ),
			normals: new Float32Array( nrm ),
			uvs: new Float32Array( uv ),
			colors: new Float32Array( col ),
			indices: new Uint32Array( idx ),
		},
		lowerPoolWaterY: 0.25,
		upperPoolWaterY: 1.06,
		nozzleTipY: 1.58,
	};

}

/**
 * Generates curved parabolic fountain water stream tubes (central crown spray + 8 radial upper-saucer overflow arcs).
 */
export function buildFountainWaterStreamsGeometry( lowerWaterY: number, upperWaterY: number, nozzleTipY: number ): MeshBuffers {

	const pos: number[] = [];
	const nrm: number[] = [];
	const uv: number[] = [];
	const col: number[] = [];
	const idx: number[] = [];

	function addParabolicArc(
		start: [ number, number, number ],
		end: [ number, number, number ],
		apexY: number,
		r0: number,
		r1: number,
		segs = 18,
		radial = 6,
	): void {

		const baseV = pos.length / 3;
		const stride = radial + 1;
		// Initialize smooth Bishop frame so high-arcing fountain jets never flip near vertical apex
		let fu: [ number, number, number ] = [ 1, 0, 0 ];
		let prevTan: [ number, number, number ] | null = null;
		for ( let i = 0; i <= segs; i ++ ) {

			const t = i / segs;
			const px = start[ 0 ] + ( end[ 0 ] - start[ 0 ] ) * t;
			const pz = start[ 2 ] + ( end[ 2 ] - start[ 2 ] ) * t;
			const py = ( 1 - t ) * ( 1 - t ) * start[ 1 ] + 2 * ( 1 - t ) * t * apexY + t * t * end[ 1 ];
			const rad = r0 + ( r1 - r0 ) * t;

			const tNext = Math.min( 1, t + 0.02 );
			const tPrev = Math.max( 0, t - 0.02 );
			const yNext = ( 1 - tNext ) * ( 1 - tNext ) * start[ 1 ] + 2 * ( 1 - tNext ) * tNext * apexY + tNext * tNext * end[ 1 ];
			const yPrev = ( 1 - tPrev ) * ( 1 - tPrev ) * start[ 1 ] + 2 * ( 1 - tPrev ) * tPrev * apexY + tPrev * tPrev * end[ 1 ];
			const tx = ( end[ 0 ] - start[ 0 ] ) * ( tNext - tPrev );
			const ty = yNext - yPrev;
			const tz = ( end[ 2 ] - start[ 2 ] ) * ( tNext - tPrev );
			const tl = Math.hypot( tx, ty, tz ) || 1;
			const tan: [ number, number, number ] = [ tx / tl, ty / tl, tz / tl ];

			if ( prevTan === null ) {

				const ref: [ number, number, number ] = Math.abs( tan[ 0 ] ) < 0.85 ? [ 1, 0, 0 ] : [ 0, 0, 1 ];
				const cx = ref[ 1 ] * tan[ 2 ] - ref[ 2 ] * tan[ 1 ];
				const cy = ref[ 2 ] * tan[ 0 ] - ref[ 0 ] * tan[ 2 ];
				const cz = ref[ 0 ] * tan[ 1 ] - ref[ 1 ] * tan[ 0 ];
				const cl = Math.hypot( cx, cy, cz ) || 1;
				fu = [ cx / cl, cy / cl, cz / cl ];

			} else {

				// Parallel transport fu orthogonal to new tan
				const d = fu[ 0 ] * tan[ 0 ] + fu[ 1 ] * tan[ 1 ] + fu[ 2 ] * tan[ 2 ];
				const ox = fu[ 0 ] - tan[ 0 ] * d;
				const oy = fu[ 1 ] - tan[ 1 ] * d;
				const oz = fu[ 2 ] - tan[ 2 ] * d;
				const ol = Math.hypot( ox, oy, oz ) || 1;
				fu = [ ox / ol, oy / ol, oz / ol ];

			}
			prevTan = tan;
			const fv: [ number, number, number ] = [
				tan[ 1 ] * fu[ 2 ] - tan[ 2 ] * fu[ 1 ],
				tan[ 2 ] * fu[ 0 ] - tan[ 0 ] * fu[ 2 ],
				tan[ 0 ] * fu[ 1 ] - tan[ 1 ] * fu[ 0 ],
			];

			for ( let j = 0; j <= radial; j ++ ) {

				const th = ( j / radial ) * Math.PI * 2;
				const ct = Math.cos( th );
				const st = Math.sin( th );
				const nx = fu[ 0 ] * ct + fv[ 0 ] * st;
				const ny = fu[ 1 ] * ct + fv[ 1 ] * st;
				const nz = fu[ 2 ] * ct + fv[ 2 ] * st;
				pos.push( px + nx * rad, py + ny * rad, pz + nz * rad );
				nrm.push( nx, ny, nz );
				uv.push( j / radial, t );
				const foam = 0.72 + 0.28 * Math.sin( t * Math.PI );
				col.push( foam * 0.85, foam * 0.96, foam );

			}

		}

		for ( let i = 0; i < segs; i ++ ) {

			for ( let j = 0; j < radial; j ++ ) {

				const a = baseV + i * stride + j;
				const b = a + 1;
				const c = a + stride;
				const d = c + 1;
				idx.push( a, b, c, b, d, c );

			}

		}

	}

	// Central plume: 8 delicate arcing jets spraying out of top finial into upper saucer
	for ( let k = 0; k < 8; k ++ ) {

		const ang = ( k / 8 ) * Math.PI * 2;
		addParabolicArc(
			[ Math.cos( ang ) * 0.015, nozzleTipY, Math.sin( ang ) * 0.015 ],
			[ Math.cos( ang ) * 0.30, upperWaterY - 0.02, Math.sin( ang ) * 0.30 ],
			nozzleTipY + 0.56,
			0.012,
			0.018,
		);

	}
	// Secondary vertical central spire jet
	for ( let k = 0; k < 4; k ++ ) {

		const ang = ( k / 4 ) * Math.PI * 2 + 0.4;
		addParabolicArc(
			[ 0, nozzleTipY, 0 ],
			[ Math.cos( ang ) * 0.14, upperWaterY, Math.sin( ang ) * 0.14 ],
			nozzleTipY + 0.82,
			0.015,
			0.010,
		);

	}
	// 10 weeping overflow arcs spilling from upper saucer lip into lower pool
	for ( let k = 0; k < 10; k ++ ) {

		const ang = ( k / 10 ) * Math.PI * 2 + 0.18;
		addParabolicArc(
			[ Math.cos( ang ) * 0.45, upperWaterY + 0.03, Math.sin( ang ) * 0.45 ],
			[ Math.cos( ang ) * 0.61, lowerWaterY - 0.02, Math.sin( ang ) * 0.61 ],
			upperWaterY + 0.07,
			0.014,
			0.022,
		);

	}

	return {
		positions: new Float32Array( pos ),
		normals: new Float32Array( nrm ),
		uvs: new Float32Array( uv ),
		colors: new Float32Array( col ),
		indices: new Uint32Array( idx ),
	};

}

/**
 * Generates the sculpted stratified rockery (假山) boulder geometry with outward normals.
 * Combines weathered convex facets with vertical karst ridges & moss-catching horizontal ledges.
 */
export function buildScholarRockMesh( spec: RockeryStoneSpec ): MeshBuffers {

	const base = buildWeatheredRock( spec.seed, spec.rx, 0.36, spec.mossCoverage, spec.detail );
	const scaleY = spec.ry / Math.max( 0.05, spec.rx );
	const scaleZ = spec.rz / Math.max( 0.05, spec.rx );
	const pos = base.positions;
	const nrm = base.normals;
	const col = base.colors!;

	// Compute fractured planar cleavage facets & stratified karst overhangs for authentic 假山 look
	for ( let i = 0; i < pos.length; i += 3 ) {

		const px = pos[ i ]!;
		const py = pos[ i + 1 ]! * scaleY;
		const pz = pos[ i + 2 ]! * scaleZ;

		// Angular cleaved rock planes & karst terrace ribs
		const strata = Math.sin( py * 12.5 + spec.seed * 0.7 ) * 0.095;
		const cleaveA = Math.abs( Math.sin( px * 4.2 + pz * 3.1 + spec.seed ) ) * 0.14;
		const cleaveB = Math.cos( px * 2.9 - py * 3.6 + spec.seed * 1.3 ) * 0.10;
		const lean = spec.tier === 'peak' ? Math.max( 0, py ) * 0.22 : 0;

		pos[ i ] = px * ( 1 + strata - cleaveA + cleaveB ) + lean;
		pos[ i + 1 ] = py * ( 1 + cleaveB * 0.35 );
		pos[ i + 2 ] = pz * ( 1 + strata * 0.85 - cleaveA * 0.7 );

		const nx = nrm[ i ]!;
		const ny = nrm[ i + 1 ]! / scaleY;
		const nz = nrm[ i + 2 ]! / scaleZ;
		const l = Math.hypot( nx, ny, nz ) || 1;
		nrm[ i ] = nx / l;
		nrm[ i + 1 ] = ny / l;
		nrm[ i + 2 ] = nz / l;

		// Keep rich granite vertex tone + natural upward moss tint (non-spotted!)
		const up = Math.max( 0, nrm[ i + 1 ]! );
		const moss = Math.min( 0.85, spec.mossCoverage * up * 1.45 * ( pos[ i + 1 ]! > - 0.04 ? 1 : 0 ) );
		col[ i ] = 0.76 * ( 1 - moss ) + 0.42 * moss;
		col[ i + 1 ] = 0.76 * ( 1 - moss ) + 0.68 * moss;
		col[ i + 2 ] = 0.74 * ( 1 - moss ) + 0.32 * moss;

	}

	// Recompute crisp faceted/smooth vertex normals from actual deformed triangles
	const idx = base.indices;
	nrm.fill( 0 );
	for ( let k = 0; k < idx.length; k += 3 ) {

		const i0 = idx[ k ]! * 3;
		const i1 = idx[ k + 1 ]! * 3;
		const i2 = idx[ k + 2 ]! * 3;
		const ax = pos[ i1 ]! - pos[ i0 ]!;
		const ay = pos[ i1 + 1 ]! - pos[ i0 + 1 ]!;
		const az = pos[ i1 + 2 ]! - pos[ i0 + 2 ]!;
		const bx = pos[ i2 ]! - pos[ i0 ]!;
		const by = pos[ i2 + 1 ]! - pos[ i0 + 1 ]!;
		const bz = pos[ i2 + 2 ]! - pos[ i0 + 2 ]!;
		const cx = ay * bz - az * by;
		const cy = az * bx - ax * bz;
		const cz = ax * by - ay * bx;
		nrm[ i0 ]! += cx; nrm[ i0 + 1 ]! += cy; nrm[ i0 + 2 ]! += cz;
		nrm[ i1 ]! += cx; nrm[ i1 + 1 ]! += cy; nrm[ i1 + 2 ]! += cz;
		nrm[ i2 ]! += cx; nrm[ i2 + 1 ]! += cy; nrm[ i2 + 2 ]! += cz;

	}
	for ( let i = 0; i < nrm.length; i += 3 ) {

		const l = Math.hypot( nrm[ i ]!, nrm[ i + 1 ]!, nrm[ i + 2 ]! ) || 1;
		nrm[ i ]! /= l; nrm[ i + 1 ]! /= l; nrm[ i + 2 ]! /= l;

	}
	return base;

}

/**
 * Builds the deterministic, strictly non-interfering Botanical Lake Garden layout plan.
 * Every flagstone, rockery stone, tree, flower, grass clump, and aquatic reed/lily
 * is checked against all exclusion SDFs & colliders.
 */
export function planBotanicalGardenLayout( seed = 2026 ): GardenLayoutPlan {

	const rng = new Mulberry32( seed );
	const colliders: CircleCollider2D[] = [];

	// 1. Fixed Architectural Anchors (Fountain inside Lake, Rockery on NW berm, 4 Trees)
	const fountainY = sampleGardenTerrainHeight( FOUNTAIN_CENTER[ 0 ], FOUNTAIN_CENTER[ 1 ] );
	colliders.push( {
		id: 'fountain',
		kind: 'fountain',
		x: FOUNTAIN_CENTER[ 0 ],
		z: FOUNTAIN_CENTER[ 1 ],
		radius: FOUNTAIN_OUTER_RADIUS + 0.25,
	} );

	const rockeryStones: RockeryStoneSpec[] = [];
	const rcX = ROCKERY_CENTER[ 0 ];
	const rcZ = ROCKERY_CENTER[ 1 ];
	const rockTemplate: Array<{ dx: number; dz: number; rx: number; ry: number; rz: number; yOff: number; yaw: number; tier: RockeryStoneSpec[ 'tier' ]; moss: number; seed: number }> = [
		// Base grounded massif boulders (embedded -0.25m into NW berm mound)
		{ dx: - 0.55, dz: 0.35, rx: 0.88, ry: 0.62, rz: 0.72, yOff: 0.14, yaw: 0.4, tier: 'base', moss: 0.46, seed: 301 },
		{ dx: 0.45, dz: 0.42, rx: 0.82, ry: 0.56, rz: 0.68, yOff: 0.12, yaw: - 0.6, tier: 'base', moss: 0.44, seed: 302 },
		{ dx: - 0.12, dz: - 0.48, rx: 0.98, ry: 0.68, rz: 0.78, yOff: 0.18, yaw: 1.1, tier: 'base', moss: 0.42, seed: 303 },
		{ dx: 0.82, dz: - 0.25, rx: 0.68, ry: 0.48, rz: 0.58, yOff: 0.10, yaw: 2.0, tier: 'base', moss: 0.40, seed: 304 },
		// Mid stacked ledges (supported atop base stones)
		{ dx: - 0.30, dz: 0.05, rx: 0.68, ry: 0.68, rz: 0.54, yOff: 0.62, yaw: 0.8, tier: 'mid', moss: 0.38, seed: 305 },
		{ dx: 0.30, dz: - 0.10, rx: 0.62, ry: 0.60, rz: 0.50, yOff: 0.58, yaw: - 0.9, tier: 'mid', moss: 0.36, seed: 306 },
		// Sculptural overhanging Taihu/karst crest peak
		{ dx: - 0.08, dz: - 0.12, rx: 0.54, ry: 0.86, rz: 0.44, yOff: 1.08, yaw: 0.35, tier: 'peak', moss: 0.28, seed: 307 },
		// Detached outer garden accent rocks (cleared from base & path)
		{ dx: 1.38, dz: 0.52, rx: 0.36, ry: 0.26, rz: 0.30, yOff: 0.04, yaw: 1.4, tier: 'accent', moss: 0.35, seed: 308 },
		{ dx: - 1.35, dz: 0.85, rx: 0.38, ry: 0.28, rz: 0.32, yOff: 0.05, yaw: 2.3, tier: 'accent', moss: 0.38, seed: 309 },
	];

	for ( let i = 0; i < rockTemplate.length; i ++ ) {

		const rt = rockTemplate[ i ]!;
		const rx = rcX + rt.dx;
		const rz = rcZ + rt.dz;
		const groundY = sampleGardenTerrainHeight( rx, rz );
		rockeryStones.push( {
			id: `rockery_${ i }`,
			x: rx,
			y: groundY + rt.yOff,
			z: rz,
			rx: rt.rx,
			ry: rt.ry,
			rz: rt.rz,
			yaw: rt.yaw,
			seed: rt.seed,
			mossCoverage: rt.moss,
			detail: 3,
			tier: rt.tier,
		} );

	}
	colliders.push( {
		id: 'rockery_footprint',
		kind: 'rockery',
		x: ROCKERY_CENTER[ 0 ],
		z: ROCKERY_CENTER[ 1 ],
		radius: ROCKERY_FOOTPRINT_RADIUS,
	} );

	// 2. Trees — 4 main courtyard trees + 5 distant woodland horizon trees framing the garden
	const trees: TreePlacementSpec[] = [
		{ id: 'tree_oak', preset: 'oak', x: - 0.25, y: 0, z: - 5.45, trunkClearanceRadius: 0.72, heightScale: 1.02, seed: 101 },
		{ id: 'tree_pine', preset: 'pine', x: 6.10, y: 0, z: - 2.65, trunkClearanceRadius: 0.58, heightScale: 0.98, seed: 202 },
		{ id: 'tree_birch', preset: 'birch', x: - 5.85, y: 0, z: 1.85, trunkClearanceRadius: 0.48, heightScale: 0.96, seed: 303 },
		{ id: 'tree_pine_east', preset: 'pine', x: 7.25, y: 0, z: 2.75, trunkClearanceRadius: 0.52, heightScale: 0.84, seed: 404 },
		{ id: 'tree_horizon_nw', preset: 'pine', x: - 9.20, y: 0, z: - 6.80, trunkClearanceRadius: 0.55, heightScale: 1.08, seed: 405 },
		{ id: 'tree_horizon_n', preset: 'birch', x: 4.50, y: 0, z: - 9.40, trunkClearanceRadius: 0.45, heightScale: 1.04, seed: 406 },
		{ id: 'tree_horizon_ne', preset: 'oak', x: 10.20, y: 0, z: - 6.20, trunkClearanceRadius: 0.65, heightScale: 1.06, seed: 407 },
		{ id: 'tree_horizon_w', preset: 'oak', x: - 9.60, y: 0, z: 0.40, trunkClearanceRadius: 0.60, heightScale: 0.92, seed: 408 },
		{ id: 'tree_horizon_nw2', preset: 'birch', x: - 6.80, y: 0, z: - 10.20, trunkClearanceRadius: 0.45, heightScale: 0.98, seed: 409 },
	];
	for ( const tr of trees ) {

		tr.y = sampleGardenTerrainHeight( tr.x, tr.z );
		colliders.push( {
			id: tr.id,
			kind: 'tree',
			x: tr.x,
			z: tr.z,
			radius: tr.trunkClearanceRadius,
		} );

	}

	// 3. Winding Flagstone Path (石板路) — arc-length sampled, strict non-overlap against neighbors, lake, rockery & trees
	const flagstones: FlagstoneSpec[] = [];
	const denseSamples = 180;
	let lastCx = Infinity;
	let lastCz = Infinity;
	let lastRad = 0;
	for ( let i = 0; i <= denseSamples; i ++ ) {

		const t = i / denseSamples;
		const [ px, pz ] = evalCatmullRom2D( PATH_CONTROL_POINTS, t );
		const [ nx, nz ] = evalCatmullRom2D( PATH_CONTROL_POINTS, Math.min( 1, t + 0.015 ) );
		const yaw = Math.atan2( nz - pz, nx - px );
		const rad = 0.30 + 0.05 * Math.sin( i * 1.7 + 0.4 );
		const minStep = Number.isFinite( lastCx ) ? lastRad + rad + 0.075 : 0;
		if ( Number.isFinite( lastCx ) && Math.hypot( px - lastCx, pz - lastCz ) < minStep ) continue;

		const sideSign = ( flagstones.length % 2 === 0 ? 1 : - 1 ) * 0.045;
		const perpX = - Math.sin( yaw ) * sideSign;
		const perpZ = Math.cos( yaw ) * sideSign;
		const sx = px + perpX;
		const sz = pz + perpZ;

		// Verify strict clearance against lake, rockery, trees, and all prior flagstones
		if ( lakeSignedDistance( sx, sz ) < rad + 0.24 ) continue;
		const overlaps = colliders.some( ( c ) => Math.hypot( sx - c.x, sz - c.z ) < rad + c.radius + 0.04 );
		if ( overlaps ) continue;

		const nrm = sampleGardenTerrainNormal( sx, sz );
		const py = sampleGardenTerrainHeight( sx, sz );
		flagstones.push( {
			id: `flagstone_${ flagstones.length }`,
			cx: sx,
			cz: sz,
			y: py,
			radius: rad,
			yaw: yaw + rng.signed() * 0.42,
			tiltX: Math.atan2( nrm[ 2 ], nrm[ 1 ] ),
			tiltZ: - Math.atan2( nrm[ 0 ], nrm[ 1 ] ),
			seed: 500 + flagstones.length,
		} );
		colliders.push( {
			id: `flagstone_${ flagstones.length - 1 }`,
			kind: 'flagstone',
			x: sx,
			z: sz,
			radius: rad,
		} );
		lastCx = sx;
		lastCz = sz;
		lastRad = rad;

	}

	// 3b. Natural Shoreline River Boulders tucked organically along non-path banks
	const shoreBoulders: RockeryStoneSpec[] = [];
	for ( let a = 0; a < 90 && shoreBoulders.length < 22; a ++ ) {

		const th = ( a / 90 ) * Math.PI * 2 + rng.signed() * 0.08;
		const bx = LAKE_CENTER[ 0 ] + Math.cos( th ) * rng.range( 2.6, 4.1 );
		const bz = LAKE_CENTER[ 1 ] + Math.sin( th ) * rng.range( 1.9, 3.1 );
		const lsd = lakeSignedDistance( bx, bz );
		if ( lsd < - 0.08 || lsd > 0.34 ) continue;
		if ( distanceToPathSpine( bx, bz ) < 0.72 ) continue;
		const rx = rng.range( 0.16, 0.32 );
		const ry = rx * rng.range( 0.55, 0.80 );
		const rz = rx * rng.range( 0.72, 1.05 );
		const blocked = colliders.some( ( c ) => Math.hypot( bx - c.x, bz - c.z ) < c.radius + rx + 0.12 )
			|| shoreBoulders.some( ( b ) => Math.hypot( bx - b.x, bz - b.z ) < b.rx + rx + 0.12 );
		if ( blocked ) continue;

		const by = sampleGardenTerrainHeight( bx, bz );
		shoreBoulders.push( {
			id: `shore_boulder_${ shoreBoulders.length }`,
			x: bx,
			y: by + ry * 0.15,
			z: bz,
			rx,
			ry,
			rz,
			yaw: rng.range( 0, Math.PI * 2 ),
			seed: 900 + shoreBoulders.length * 11,
			mossCoverage: 0.34,
			detail: 2,
			tier: 'accent',
		} );
		colliders.push( { id: `shore_boulder_${ shoreBoulders.length - 1 }`, kind: 'rockery', x: bx, z: bz, radius: rx + 0.04 } );

	}

	// Helper to test dry-land collision-free placement for flowers & grass
	const isDrySpotClear = ( x: number, z: number, r: number, minLakeClearance = 0.24 ): boolean => {

		if ( lakeSignedDistance( x, z ) < minLakeClearance + r ) return false;
		for ( const c of colliders ) {

			if ( Math.hypot( x - c.x, z - c.z ) < r + c.radius ) return false;

		}
		return true;

	};

	// 4. Curated Multi-Bed Flower Clusters bordering path, rockery apron & sunny shoreline
	const flowerBeds: Array<{ preset: FlowerPlacementSpec[ 'preset' ]; cx: number; cz: number; count: number; spread: number }> = [
		{ preset: 'daisy', cx: - 0.15, cz: 3.75, count: 6, spread: 0.72 },
		{ preset: 'tulip', cx: - 2.35, cz: 2.35, count: 6, spread: 0.65 },
		{ preset: 'rose', cx: 1.55, cz: 2.85, count: 6, spread: 0.78 },
		{ preset: 'daisy', cx: 4.55, cz: 2.45, count: 5, spread: 0.75 },
		{ preset: 'tulip', cx: - 2.85, cz: - 0.15, count: 5, spread: 0.62 },
		{ preset: 'rose', cx: - 2.65, cz: - 3.35, count: 5, spread: 0.68 },
		{ preset: 'daisy', cx: 3.65, cz: - 3.25, count: 5, spread: 0.72 },
	];
	const flowers: FlowerPlacementSpec[] = [];
	for ( let b = 0; b < flowerBeds.length; b ++ ) {

		const bed = flowerBeds[ b ]!;
		let placed = 0;
		let attempts = 0;
		while ( placed < bed.count && attempts < 50 ) {

			attempts ++;
			const ang = rng.range( 0, Math.PI * 2 );
			const d = Math.sqrt( rng.next() ) * bed.spread;
			const fx = bed.cx + Math.cos( ang ) * d;
			const fz = bed.cz + Math.sin( ang ) * d;
			const fRad = 0.14;
			if ( ! isDrySpotClear( fx, fz, fRad, 0.25 ) ) continue;

			const fy = sampleGardenTerrainHeight( fx, fz );
			const fId = `flower_${ flowers.length }`;
			flowers.push( {
				id: fId,
				preset: bed.preset,
				x: fx,
				y: fy,
				z: fz,
				heightMeters: rng.range( 0.42, 0.56 ),
				seed: 700 + flowers.length * 7,
				radius: fRad,
			} );
			colliders.push( { id: fId, kind: 'flower', x: fx, z: fz, radius: fRad } );
			placed ++;

		}

	}

	// 5. Dense Lush Lawn & Meadow Turf (collision-free against lake, path slabs, rockery, fountain, trees & flowers)
	const grassClumps: GrassPlacementSpec[] = [];
	const targetGrass = 980;
	let gAttempts = 0;
	while ( grassClumps.length < targetGrass && gAttempts < 8200 ) {

		gAttempts ++;
		const ang = rng.range( 0, Math.PI * 2 );
		const dist = Math.sqrt( rng.next() ) * 12.6;
		const gx = Math.cos( ang ) * dist;
		const gz = Math.sin( ang ) * dist;
		const gRad = 0.08;

		// Keep grass completely out of the lake, off flagstone slabs, out of rockery stones & tree trunks
		if ( lakeSignedDistance( gx, gz ) < 0.16 ) continue;
		if ( distanceToPathSpine( gx, gz ) < 0.44 ) continue;
		let blocked = false;
		for ( const c of colliders ) {

			if ( c.kind === 'grass' ) continue; // Lawn blades naturally cluster together!
			const pad = c.kind === 'flagstone' ? 0.12 : c.kind === 'flower' ? 0.05 : 0.08;
			if ( Math.hypot( gx - c.x, gz - c.z ) < c.radius + pad ) {

				blocked = true;
				break;

			}

		}
		if ( blocked ) continue;

		const gy = sampleGardenTerrainHeight( gx, gz );
		const rChoice = rng.next();
		const preset: GrassPresetIdCompat = rChoice < 0.62 ? 'fescue' : rChoice < 0.85 ? 'sedge' : 'foxtail';
		const nearShore = lakeSignedDistance( gx, gz ) < 0.9;
		const sc = nearShore ? rng.range( 0.95, 1.35 ) : rng.range( 0.72, 1.22 );
		grassClumps.push( {
			id: `grass_${ grassClumps.length }`,
			preset,
			x: gx,
			y: gy,
			z: gz,
			scale: sc,
			yaw: rng.range( 0, Math.PI * 2 ),
			radius: gRad,
		} );

	}

	// 6. Aquatic Shoreline Reeds (Sedge) & Floating Water Lilies in shallow lake zone (clear of fountain!)
	const reeds: Array<{ x: number; y: number; z: number; scale: number; yaw: number }> = [];
	for ( let a = 0; a < 90 && reeds.length < 24; a ++ ) {

		const th = rng.range( 0, Math.PI * 2 );
		const rx = LAKE_CENTER[ 0 ] + Math.cos( th ) * rng.range( 2.1, 3.6 );
		const rz = LAKE_CENTER[ 1 ] + Math.sin( th ) * rng.range( 1.5, 2.7 );
		const lsd = lakeSignedDistance( rx, rz );
		// Shallow rim zone: -0.28 < lsd < +0.16
		if ( lsd < - 0.28 || lsd > 0.16 ) continue;
		if ( Math.hypot( rx - FOUNTAIN_CENTER[ 0 ], rz - FOUNTAIN_CENTER[ 1 ] ) < FOUNTAIN_OUTER_RADIUS + 0.85 ) continue;
		if ( distanceToPathSpine( rx, rz ) < 0.75 ) continue;

		reeds.push( {
			x: rx,
			y: sampleGardenTerrainHeight( rx, rz ),
			z: rz,
			scale: rng.range( 1.15, 1.55 ),
			yaw: rng.range( 0, Math.PI * 2 ),
		} );

	}

	const lilyPads: LilyPadSpec[] = [];
	for ( let a = 0; a < 70 && lilyPads.length < 14; a ++ ) {

		const th = rng.range( 0, Math.PI * 2 );
		const lx = LAKE_CENTER[ 0 ] + Math.cos( th ) * rng.range( 0.8, 3.1 );
		const lz = LAKE_CENTER[ 1 ] + Math.sin( th ) * rng.range( 0.5, 2.2 );
		if ( lakeSignedDistance( lx, lz ) > - 0.35 ) continue;
		const padR = rng.range( 0.14, 0.22 );
		if ( Math.hypot( lx - FOUNTAIN_CENTER[ 0 ], lz - FOUNTAIN_CENTER[ 1 ] ) < FOUNTAIN_OUTER_RADIUS + padR + 0.45 ) continue;
		if ( lilyPads.some( ( p ) => Math.hypot( lx - p.x, lz - p.z ) < p.radius + padR + 0.08 ) ) continue;
		lilyPads.push( {
			x: lx,
			z: lz,
			radius: padR,
			hasBloom: lilyPads.length % 3 === 0,
			yaw: rng.range( 0, Math.PI * 2 ),
		} );

	}

	return {
		waterLevel: WATER_LEVEL,
		lakeCenter: LAKE_CENTER,
		fountainPos: [ FOUNTAIN_CENTER[ 0 ], fountainY, FOUNTAIN_CENTER[ 1 ] ],
		fountainOuterRadius: FOUNTAIN_OUTER_RADIUS,
		rockeryCenter: ROCKERY_CENTER,
		rockeryFootprintRadius: ROCKERY_FOOTPRINT_RADIUS,
		pathSpine: DENSE_SPINE,
		flagstones,
		rockeryStones,
		shoreBoulders,
		trees,
		flowers,
		grassClumps,
		lilyPads,
		reeds,
		colliders,
	};

}

type GrassPresetIdCompat = 'fescue' | 'foxtail' | 'sedge';

/**
 * Automated spatial collision & containment invariant audit for GardenLayoutPlan.
 * Returns empty violations array when all non-interference constraints hold.
 */
export function verifyGardenNonInterference( plan: GardenLayoutPlan ): string[] {

	const violations: string[] = [];

	// 1. No flagstone overlaps another flagstone, lake, rockery, fountain, or tree
	for ( let i = 0; i < plan.flagstones.length; i ++ ) {

		const a = plan.flagstones[ i ]!;
		if ( lakeSignedDistance( a.cx, a.cz ) < a.radius + 0.20 ) {

			violations.push( `${ a.id } encroaches lake shoreline` );

		}
		for ( let j = i + 1; j < plan.flagstones.length; j ++ ) {

			const b = plan.flagstones[ j ]!;
			const d = Math.hypot( a.cx - b.cx, a.cz - b.cz );
			if ( d < a.radius + b.radius + 0.03 ) {

				violations.push( `${ a.id } overlaps ${ b.id } (dist=${ d.toFixed( 3 ) })` );

			}

		}
		for ( const tr of plan.trees ) {

			if ( Math.hypot( a.cx - tr.x, a.cz - tr.z ) < a.radius + tr.trunkClearanceRadius ) {

				violations.push( `${ a.id } collides with ${ tr.id }` );

			}

		}
		if ( Math.hypot( a.cx - plan.rockeryCenter[ 0 ], a.cz - plan.rockeryCenter[ 1 ] ) < a.radius + plan.rockeryFootprintRadius ) {

			violations.push( `${ a.id } collides with rockery` );

		}

	}

	// 2. Fountain strictly inside lake basin with open water clearance around coping
	const fLsd = lakeSignedDistance( plan.fountainPos[ 0 ], plan.fountainPos[ 2 ] );
	if ( fLsd > - ( plan.fountainOuterRadius + 0.15 ) ) {

		violations.push( `fountain too close to shoreline (lakeSDF=${ fLsd.toFixed( 3 ) })` );

	}

	// 3. No trees inside lake, rockery, or colliding with each other
	for ( const tr of plan.trees ) {

		if ( lakeSignedDistance( tr.x, tr.z ) < tr.trunkClearanceRadius + 0.35 ) {

			violations.push( `${ tr.id } inside/too close to lake` );

		}
		if ( Math.hypot( tr.x - plan.rockeryCenter[ 0 ], tr.z - plan.rockeryCenter[ 1 ] ) < tr.trunkClearanceRadius + plan.rockeryFootprintRadius ) {

			violations.push( `${ tr.id } collides with rockery` );

		}

	}

	// 4. No flowers or grass inside lake, on flagstones, inside rockery, fountain, or tree trunks
	for ( const fl of plan.flowers ) {

		if ( lakeSignedDistance( fl.x, fl.z ) < 0.20 ) violations.push( `${ fl.id } inside lake` );
		for ( const st of plan.flagstones ) {

			if ( Math.hypot( fl.x - st.cx, fl.z - st.cz ) < st.radius + fl.radius ) {

				violations.push( `${ fl.id } clips ${ st.id }` );

			}

		}

	}
	for ( const gr of plan.grassClumps ) {

		if ( lakeSignedDistance( gr.x, gr.z ) < 0.14 ) {

			violations.push( `${ gr.id } underwater in lake` );

		}
		for ( const st of plan.flagstones ) {

			if ( Math.hypot( gr.x - st.cx, gr.z - st.cz ) < st.radius + 0.08 ) {

				violations.push( `${ gr.id } grows through ${ st.id }` );

			}

		}
		if ( Math.hypot( gr.x - plan.rockeryCenter[ 0 ], gr.z - plan.rockeryCenter[ 1 ] ) < plan.rockeryFootprintRadius ) {

			violations.push( `${ gr.id } clips inside rockery` );

		}

	}

	// 5. Lily pads strictly inside lake water and clear of fountain
	for ( let i = 0; i < plan.lilyPads.length; i ++ ) {

		const lp = plan.lilyPads[ i ]!;
		if ( lakeSignedDistance( lp.x, lp.z ) > - 0.25 ) {

			violations.push( `lilyPad_${ i } outside deep lake` );

		}
		if ( Math.hypot( lp.x - plan.fountainPos[ 0 ], lp.z - plan.fountainPos[ 2 ] ) < plan.fountainOuterRadius + lp.radius + 0.2 ) {

			violations.push( `lilyPad_${ i } clips fountain` );

		}

	}

	// 6. Shoreline boulders clear of flagstones, fountain & tree trunks
	for ( const sb of plan.shoreBoulders ) {

		for ( const st of plan.flagstones ) {

			if ( Math.hypot( sb.x - st.cx, sb.z - st.cz ) < sb.rx + st.radius ) {

				violations.push( `${ sb.id } collides with ${ st.id }` );

			}

		}
		for ( const tr of plan.trees ) {

			if ( Math.hypot( sb.x - tr.x, sb.z - tr.z ) < sb.rx + tr.trunkClearanceRadius ) {

				violations.push( `${ sb.id } collides with ${ tr.id }` );

			}

		}

	}

	return violations;

}
