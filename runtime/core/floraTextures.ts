/**
 * Pure-data Procedural PBR Texture Generators (`Surface::shaped` Bark, Soil,
 * Submerged River Pebbles, Detailed Multi-Leaf Botanical Sprig Atlases, Fern Fronds,
 * Stratified Karst Limestone, Carved Travertine, Split Slate & Periodic Water Normals).
 * Zero DOM / Zero Three.js dependencies.
 */

import { Mulberry32, periodicFbm2D, periodicValueNoise2D, periodicWorley2D } from './prng.ts';
import {
	buildCoveragePreservingMipmaps,
	synthesizeShapedSurface,
	type MipLevel,
	type ShapedSurfaceBuffers,
} from './shapedSurface.ts';
import type { TreePresetId } from './botanicalFlora.ts';

function clamp01( x: number ): number {

	return x < 0 ? 0 : x > 1 ? 1 : x;

}

export function synthesizeBarkSurface( preset: TreePresetId, size = 512, seed = 42 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		1.9,
		( u, v ) => {

			if ( preset === 'birch' ) {

				const warp = periodicFbm2D( u, v, 5, 3, seed ) * 0.16;
				const lenticel = Math.exp( - Math.pow( Math.sin( v * Math.PI * 14 + warp * 8.0 ), 2 ) * 18 );
				const darkPatch = clamp01( ( periodicFbm2D( u * 1.0, ( v * 0.5 ) % 1.0, 4, 3, seed + 29 ) - 0.54 ) * 4.5 );
				const papery = periodicFbm2D( u, v, 10, 4, seed + 13 );
				const h = - 0.012 * lenticel - 0.014 * darkPatch + 0.008 * ( papery - 0.5 );
				return [ h, Math.max( lenticel, darkPatch * 0.9 ) ];

			}
			if ( preset === 'pine' ) {

				const warpU = ( periodicFbm2D( u, v, 4, 3, seed ) - 0.5 ) * 0.12;
				const plate = periodicWorley2D( ( u + warpU + 1 ) % 1, ( v * 0.65 ) % 1.0, 7, seed + 5 );
				const fissure = Math.max( 0, 1 - plate * 3.4 );
				const flake = periodicFbm2D( u, v, 12, 3, seed + 17 );
				const h = - 0.030 * fissure + 0.012 * ( flake - 0.5 );
				return [ h, fissure ];

			}
			// Oak furrowed bark ridges with vertical organic fissures & moss micro-hints
			const warp = periodicFbm2D( u, v, 4, 3, seed ) * 0.16;
			const ridgeA = Math.sin( ( u + warp ) * Math.PI * 12 );
			const ridgeB = Math.sin( ( u - warp * 0.5 ) * Math.PI * 22 + v * Math.PI * 2 );
			const crossCrack = periodicFbm2D( u, ( v * 2.0 ) % 1.0, 9, 4, seed + 23 );
			const h = 0.028 * ( 0.48 * ridgeA + 0.24 * ridgeB + 0.28 * ( crossCrack - 0.5 ) );
			return [ h, clamp01( 0.5 + 0.35 * ridgeA + 0.15 * ridgeB ) ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.72 + r.medium * 11 + r.broad * 4 );
			const wear = clamp01( r.medium * 14 + r.fine * 20 );

			if ( preset === 'birch' ) {

				const band = clamp01( ( r.tag - 0.42 ) * 2.2 );
				const cream = 0.72 + 0.12 * cavity + 0.04 * ( periodicValueNoise2D( u, v, 24, seed + 7 ) - 0.5 );
				return {
					color: [
						cream * ( 1 - band ) + 0.16 * band,
						cream * 0.97 * ( 1 - band ) + 0.14 * band,
						cream * 0.90 * ( 1 - band ) + 0.12 * band,
					],
					alpha: 1,
					roughness: clamp01( 0.76 - 0.10 * wear + 0.16 * band ),
					metalness: 0,
					cavity,
				};

			}
			if ( preset === 'pine' ) {

				const darkCrevice = r.tag * 0.65;
				const warmBark = periodicFbm2D( u, v, 5, 2, seed + 43 );
				return {
					color: [
						( ( 0.34 + 0.08 * warmBark ) * ( 1 - darkCrevice ) + 0.04 * wear ) * cavity,
						( ( 0.21 + 0.04 * warmBark ) * ( 1 - darkCrevice ) + 0.025 * wear ) * cavity,
						( 0.13 * ( 1 - darkCrevice ) + 0.02 * wear ) * cavity,
					],
					alpha: 1,
					roughness: clamp01( 0.88 - 0.10 * wear + 0.08 * darkCrevice ),
					metalness: 0,
					cavity,
				};

			}
			const mossTint = clamp01( ( periodicFbm2D( u, v, 4, 3, seed + 71 ) - 0.58 ) * 3.0 ) * clamp01( 0.7 - r.tag );
			return {
				color: [
					( 0.24 * ( 0.60 + 0.40 * cavity ) + 0.03 * wear ) * ( 1 - mossTint * 0.55 ) + 0.09 * mossTint,
					( 0.20 * ( 0.60 + 0.40 * cavity ) + 0.025 * wear ) * ( 1 - mossTint * 0.35 ) + 0.17 * mossTint,
					( 0.15 * ( 0.60 + 0.40 * cavity ) + 0.02 * wear ) * ( 1 - mossTint * 0.65 ) + 0.05 * mossTint,
				],
				alpha: 1,
				roughness: clamp01( 0.91 - 0.10 * wear ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Rich Forest Floor Humus, Lush Turf Moss, Micro-Clover & Fallen Leaf Litter (512px PBR).
 */
export function synthesizeSoilSurface( size = 512, seed = 77 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		2.2,
		( u, v ) => {

			const broad = periodicFbm2D( u, v, 5, 4, seed );
			const mossBump = periodicFbm2D( u, v, 14, 3, seed + 19 );
			const grain = periodicValueNoise2D( u, v, 40, seed + 37 );
			return [ 0.030 * ( broad - 0.5 ) + 0.016 * ( mossBump - 0.5 ) + 0.006 * ( grain - 0.5 ), mossBump ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.72 + r.medium * 12 + r.broad * 4 );
			const mossMacro = clamp01( ( periodicFbm2D( u, v, 3, 3, seed + 99 ) - 0.14 ) * 2.8 );
			const lushTurf = clamp01( ( periodicFbm2D( u, v, 9, 3, seed + 151 ) - 0.22 ) * 2.9 );
			const litter = clamp01( ( periodicValueNoise2D( u, v, 34, seed + 211 ) - 0.78 ) * 2.2 ) * ( 1 - lushTurf * 0.8 );
			const greenBlend = clamp01( mossMacro * 0.78 + lushTurf * 0.65 );
			const warmSun = periodicFbm2D( u, v, 5, 2, seed + 313 );
			return {
				color: [
					( 0.088 * ( 1 - greenBlend ) + ( 0.088 + 0.048 * warmSun ) * greenBlend + 0.06 * litter ) * cavity,
					( 0.095 * ( 1 - greenBlend ) + ( 0.235 + 0.080 * warmSun ) * greenBlend + 0.04 * litter ) * cavity,
					( 0.025 * ( 1 - greenBlend ) + 0.018 * greenBlend + 0.012 * litter ) * cavity,
				],
				alpha: 1,
				roughness: clamp01( 0.92 - 0.06 * greenBlend + 0.04 * litter ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Submerged Sunlit River Pebble & Gravel Bed PBR for shallow pond margins (matching R01/R02).
 */
export function synthesizePebbleBedSurface( size = 512, seed = 211 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		2.4,
		( u, v ) => {

			const coarsePebble = periodicWorley2D( u, v, 14, seed );
			const fineGravel = periodicWorley2D( u, v, 28, seed + 31 );
			const dome = Math.max( 0, 1 - coarsePebble * 1.9 );
			const grit = Math.max( 0, 1 - fineGravel * 2.1 );
			const sand = periodicFbm2D( u, v, 10, 3, seed + 61 );
			return [ 0.028 * dome + 0.011 * grit + 0.008 * ( sand - 0.5 ), dome ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.62 + r.medium * 16 + r.broad * 4 );
			const mineralTone = periodicValueNoise2D( u, v, 16, seed + 89 );
			const silt = clamp01( 1 - r.tag * 1.4 );
			const ochre = clamp01( ( mineralTone - 0.45 ) * 2.0 );
			const pr = 0.22 + 0.16 * ochre - 0.08 * silt;
			const pg = 0.19 + 0.11 * ochre - 0.06 * silt;
			const pb = 0.13 + 0.04 * ochre - 0.04 * silt;
			return {
				color: [ pr * cavity, pg * cavity, pb * cavity ],
				alpha: 1,
				roughness: clamp01( 0.34 + 0.30 * silt ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Surface::shaped Carved Weathered Travertine / Limestone PBR for the Fountain (喷泉).
 * Warm antique limestone with wet-zone weathering, mossy drip grooves & fine porous grain.
 */
export function synthesizeCarvedLimestoneSurface( size = 512, seed = 61 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		2.2,
		( u, v ) => {

			const warp = periodicFbm2D( u, v, 3, 3, seed ) * 0.28;
			const strata = Math.sin( ( v + warp * 0.35 ) * Math.PI * 14 ) * 0.005;
			const pit = ( periodicFbm2D( u, v, 14, 4, seed + 17 ) - 0.5 ) * 0.011;
			const micro = ( periodicValueNoise2D( u, v, 36, seed + 31 ) - 0.5 ) * 0.004;
			return [ strata + pit + micro, pit > 0.002 ? 1 : 0 ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.80 + r.medium * 11 + r.broad * 3 );
			const wear = clamp01( r.medium * 15 + r.fine * 22 );
			const vein = periodicFbm2D( u * 1.0, ( v * 0.5 ) % 1.0, 5, 3, seed + 41 );
			const grain = periodicValueNoise2D( u, v, 38, seed + 59 );
			const dampMoss = clamp01( ( periodicFbm2D( u, v, 6, 3, seed + 101 ) - 0.60 ) * 2.8 ) * ( 1 - cavity * 0.55 );
			const stoneBase = ( 0.66 + 0.12 * vein + 0.08 * wear + 0.04 * ( grain - 0.5 ) ) * cavity;
			return {
				color: [
					stoneBase * 1.04 * ( 1 - dampMoss * 0.52 ) + 0.12 * dampMoss,
					stoneBase * 0.94 * ( 1 - dampMoss * 0.30 ) + 0.17 * dampMoss,
					stoneBase * 0.74 * ( 1 - dampMoss * 0.65 ) + 0.05 * dampMoss,
				],
				alpha: 1,
				roughness: clamp01( 0.64 - 0.16 * wear + 0.12 * dampMoss ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Surface::shaped Natural Split Bluestone / Slate PBR for Irregular Flagstones (石板路).
 * Layered split slate cleavage, warm mineral flecks & mossy edge weathering.
 */
export function synthesizeFlagstoneSlateSurface( size = 512, seed = 83 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		2.1,
		( u, v ) => {

			const warpU = ( periodicFbm2D( u, v, 4, 3, seed ) - 0.5 ) * 0.25;
			const warpV = ( periodicFbm2D( u, v, 4, 3, seed + 9 ) - 0.5 ) * 0.25;
			const cleavage = ( periodicFbm2D( u + warpU * 0.22, v + warpV * 0.22, 6, 4, seed + 19 ) - 0.5 ) * 0.022;
			const stepLedge = Math.sin( ( u * 0.6 + v * 0.8 + warpU ) * Math.PI * 5 ) * 0.006;
			const veinDist = Math.abs( periodicFbm2D( u + warpU, v + warpV, 5, 3, seed + 37 ) - 0.5 );
			const vein = - 0.012 * Math.max( 0, 1 - veinDist * 15 );
			const grit = ( periodicValueNoise2D( u, v, 36, seed + 53 ) - 0.5 ) * 0.005;
			return [ cleavage + stepLedge + vein + grit, veinDist < 0.045 ? 1 : 0 ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.78 + r.medium * 12 + r.broad * 3 );
			const wear = clamp01( r.medium * 16 + r.fine * 24 );
			const fleck = periodicValueNoise2D( u, v, 44, seed + 71 ) > 0.78 ? 0.07 : 0.0;
			const warmShift = periodicFbm2D( u, v, 4, 2, seed + 93 );
			const base = ( 0.42 + 0.12 * wear + fleck ) * cavity;
			const lichen = clamp01( ( periodicFbm2D( u, v, 7, 3, seed + 127 ) - 0.60 ) * 3.0 );
			return {
				color: [
					( base * ( 0.98 + 0.18 * warmShift ) ) * ( 1 - lichen * 0.30 ) + 0.16 * lichen,
					( base * ( 0.96 + 0.12 * warmShift ) ) * ( 1 - lichen * 0.16 ) + 0.22 * lichen,
					( base * 0.90 ) * ( 1 - lichen * 0.45 ) + 0.06 * lichen,
				],
				alpha: 1,
				roughness: clamp01( 0.76 - 0.16 * wear + 0.14 * lichen ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Surface::shaped Sharp Stratified Karst Limestone PBR for the Rockery (假山).
 * High-contrast angular rock cleavage, deep crevice shadow AO, calcite streaks & restrained crevice moss.
 */
export function synthesizeScholarRockSurface( size = 512, seed = 109 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		2.8,
		( u, v ) => {

			const wU = ( periodicFbm2D( u, v, 4, 3, seed ) - 0.5 ) * 0.34;
			const wV = ( periodicFbm2D( u, v, 4, 3, seed + 13 ) - 0.5 ) * 0.34;
			// Jagged vertical karst limestone cleavage & chiseled mineral pockets (no horizontal stripes!)
			const vertFold = Math.sin( ( u + wU * 0.55 ) * Math.PI * 10 ) * 0.018;
			const broad = ( periodicFbm2D( u + wU * 0.30, v + wV * 0.30, 6, 4, seed + 7 ) - 0.5 ) * 0.055;
			const fissureV = Math.abs( periodicFbm2D( ( u * 1.4 + wU ) % 1, v * 0.7 + wV * 0.2, 7, 3, seed + 23 ) - 0.5 );
			const fissureH = Math.abs( periodicFbm2D( u * 0.6 + wU * 0.2, ( v * 1.3 + wV ) % 1, 8, 3, seed + 41 ) - 0.5 );
			const crack = - 0.022 * Math.max( 0, 1 - fissureV * 16 ) - 0.014 * Math.max( 0, 1 - fissureH * 18 );
			const grain = ( periodicValueNoise2D( u, v, 48, seed + 53 ) - 0.5 ) * 0.012;
			return [ vertFold + broad + crack + grain, Math.max( 0, 1 - fissureV * 14 ) ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.80 + r.medium * 10 + r.broad * 3 );
			const wear = clamp01( r.medium * 16 + r.fine * 22 );
			const quartz = periodicValueNoise2D( u, v, 48, seed + 89 ) > 0.80 ? 0.10 : 0;
			const calcite = clamp01( ( r.tag - 0.74 ) * 1.6 );
			const warmLichen = clamp01( ( periodicFbm2D( u, v, 7, 3, seed + 131 ) - 0.58 ) * 2.6 ) * ( 1 - calcite );
			const creviceMoss = clamp01( ( periodicFbm2D( u, v, 5, 3, seed + 177 ) - 0.50 ) * 2.8 ) * clamp01( 0.85 - cavity * 0.40 );
			const stone = ( 0.72 + 0.14 * wear + quartz + 0.08 * calcite ) * cavity;
			return {
				color: [
					stone * 1.04 * ( 1 - creviceMoss * 0.65 ) * ( 1 - warmLichen * 0.15 ) + 0.10 * creviceMoss + 0.17 * warmLichen,
					stone * 0.98 * ( 1 - creviceMoss * 0.35 ) * ( 1 - warmLichen * 0.06 ) + 0.20 * creviceMoss + 0.21 * warmLichen,
					stone * 0.86 * ( 1 - creviceMoss * 0.75 ) * ( 1 - warmLichen * 0.32 ) + 0.04 * creviceMoss + 0.08 * warmLichen,
				],
				alpha: 1,
				roughness: clamp01( 0.84 - 0.16 * wear + 0.12 * creviceMoss - 0.06 * quartz ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Seamless Periodic 512px Water Ripple Normal Map (linear tangent space RGB) for Three.js `Water.js`.
 */
export function synthesizeWaterNormalMap( size = 512, seed = 149 ): Uint8Array {

	const heights = new Float32Array( size * size );
	for ( let y = 0; y < size; y ++ ) {

		const v = y / size;
		for ( let x = 0; x < size; x ++ ) {

			const u = x / size;
			const w1 = periodicFbm2D( u, v, 5, 4, seed );
			const w2 = Math.sin( ( u * 5 + v * 3 ) * Math.PI * 2 ) * 0.16;
			const w3 = Math.cos( ( u * 4 - v * 6 ) * Math.PI * 2 ) * 0.13;
			const capillary = periodicFbm2D( u, v, 14, 3, seed + 47 ) * 0.22;
			heights[ y * size + x ] = w1 * 0.58 + w2 + w3 + capillary;

		}

	}

	const out = new Uint8Array( size * size * 4 );
	const strength = 6.2;
	for ( let y = 0; y < size; y ++ ) {

		const ym = ( y - 1 + size ) % size;
		const yp = ( y + 1 ) % size;
		for ( let x = 0; x < size; x ++ ) {

			const xm = ( x - 1 + size ) % size;
			const xp = ( x + 1 ) % size;
			const dhx = ( heights[ y * size + xp ]! - heights[ y * size + xm ]! ) * strength;
			const dhy = ( heights[ yp * size + x ]! - heights[ ym * size + x ]! ) * strength;
			const l = Math.hypot( - dhx, - dhy, 1 ) || 1;
			const p4 = ( y * size + x ) * 4;
			out[ p4 ] = Math.round( ( ( - dhx / l ) * 0.5 + 0.5 ) * 255 );
			out[ p4 + 1 ] = Math.round( ( ( - dhy / l ) * 0.5 + 0.5 ) * 255 );
			out[ p4 + 2 ] = Math.round( ( ( 1 / l ) * 0.5 + 0.5 ) * 255 );
			out[ p4 + 3 ] = 255;

		}

	}
	return out;

}

export type FoliageAtlasKind = TreePresetId | 'fern' | 'shrub';

export interface LeafAtlasResult {
	size: number;
	albedoMips: MipLevel[];
	normalLinear: Uint8Array;
	ormLinear: Uint8Array;
}

interface LeafSpec {
	cx: number;
	cy: number;
	angle: number;
	len: number;
	wid: number;
	hue: number;
	light: number;
	kind: 'oak' | 'birch' | 'pine' | 'fernPinna' | 'twig';
}

function buildBotanicalSprigSpec( kind: FoliageAtlasKind ): LeafSpec[] {

	const rObj = new Mulberry32( kind === 'oak' ? 7101 : kind === 'birch' ? 7202 : kind === 'pine' ? 7303 : 7404 );
	const rng = () => rObj.next();
	const items: LeafSpec[] = [];

	if ( kind === 'fern' ) {

		// Central curved fern rachis + 26 paired tapering pinnate pinnae
		items.push( { cx: 0.50, cy: 0.04, angle: 0, len: 0.90, wid: 0.011, hue: 0, light: 0.72, kind: 'twig' } );
		for ( let i = 0; i < 14; i ++ ) {

			const t = 0.08 + ( i / 13 ) * 0.84;
			const env = Math.sin( Math.pow( t, 0.72 ) * Math.PI * 0.94 );
			const pLen = 0.07 + 0.34 * env;
			const pWid = 0.034 * ( 0.45 + 0.55 * env );
			for ( const s of [ - 1, 1 ] ) {

				items.push( {
					cx: 0.50 + s * 0.006,
					cy: 0.04 + t * 0.88 + ( s > 0 ? 0.016 : 0 ),
					angle: s * ( 1.12 - 0.35 * t ),
					len: pLen,
					wid: pWid,
					hue: ( rng() - 0.5 ) * 0.04,
					light: 0.88 + 0.24 * t,
					kind: 'fernPinna',
				} );

			}

		}
		return items;

	}

	if ( kind === 'pine' ) {

		// Branched woody twiglet + 3 layered tufts of crisp slender pine needles (44 needles)
		items.push( { cx: 0.50, cy: 0.08, angle: 0, len: 0.62, wid: 0.012, hue: 0, light: 0.65, kind: 'twig' } );
		const hubs = [
			{ x: 0.50, y: 0.46, n: 16, r: 0.34 },
			{ x: 0.34, y: 0.60, n: 14, r: 0.28 },
			{ x: 0.66, y: 0.58, n: 14, r: 0.28 },
		];
		for ( const h of hubs ) {

			for ( let i = 0; i < h.n; i ++ ) {

				const ang = - Math.PI * 0.78 + ( i / Math.max( 1, h.n - 1 ) ) * Math.PI * 1.56 + ( rng() - 0.5 ) * 0.14;
				items.push( {
					cx: h.x,
					cy: h.y,
					angle: ang,
					len: h.r * ( 0.78 + rng() * 0.32 ),
					wid: 0.013,
					hue: ( rng() - 0.5 ) * 0.03,
					light: 0.80 + rng() * 0.35,
					kind: 'pine',
				} );

			}

		}
		return items;

	}

	if ( kind === 'birch' ) {

		// Airy delicate silver-birch twig spray: 16 small crisp ovate serrated leaves
		items.push( { cx: 0.50, cy: 0.06, angle: 0.08, len: 0.76, wid: 0.008, hue: 0, light: 0.68, kind: 'twig' } );
		items.push( { cx: 0.48, cy: 0.36, angle: - 0.62, len: 0.34, wid: 0.006, hue: 0, light: 0.68, kind: 'twig' } );
		items.push( { cx: 0.52, cy: 0.46, angle: 0.60, len: 0.32, wid: 0.006, hue: 0, light: 0.68, kind: 'twig' } );
		const spots = [
			[ 0.50, 0.78, 0.0, 0.19 ], [ 0.42, 0.70, - 0.65, 0.18 ], [ 0.58, 0.72, 0.62, 0.18 ],
			[ 0.32, 0.56, - 0.95, 0.17 ], [ 0.24, 0.46, - 1.25, 0.16 ], [ 0.38, 0.42, - 0.55, 0.15 ],
			[ 0.68, 0.60, 0.90, 0.17 ], [ 0.76, 0.50, 1.22, 0.16 ], [ 0.62, 0.44, 0.50, 0.15 ],
			[ 0.46, 0.54, - 0.35, 0.16 ], [ 0.55, 0.56, 0.38, 0.16 ], [ 0.40, 0.28, - 1.05, 0.15 ],
			[ 0.60, 0.30, 1.05, 0.15 ], [ 0.50, 0.22, 0.12, 0.14 ], [ 0.28, 0.66, - 1.45, 0.14 ],
			[ 0.72, 0.68, 1.45, 0.14 ],
		];
		for ( const [ sx, sy, ang, l ] of spots ) {

			items.push( {
				cx: sx!,
				cy: sy!,
				angle: ang! + ( rng() - 0.5 ) * 0.22,
				len: l!,
				wid: l! * 0.54,
				hue: ( rng() - 0.5 ) * 0.06,
				light: 0.85 + rng() * 0.30,
				kind: 'birch',
			} );

		}
		return items;

	}

	if ( kind === 'shrub' ) {

		// Dense multi-branched laurel/boxwood shrub sprig with 34 small crisp leaves!
		items.push( { cx: 0.50, cy: 0.05, angle: 0.02, len: 0.80, wid: 0.009, hue: 0, light: 0.62, kind: 'twig' } );
		items.push( { cx: 0.49, cy: 0.25, angle: - 0.58, len: 0.42, wid: 0.007, hue: 0, light: 0.62, kind: 'twig' } );
		items.push( { cx: 0.51, cy: 0.35, angle: 0.56, len: 0.42, wid: 0.007, hue: 0, light: 0.62, kind: 'twig' } );
		for ( let i = 0; i < 34; i ++ ) {

			const th = i * 2.3999632 + rng() * 0.4;
			const rad = Math.sqrt( ( i + 0.5 ) / 34 ) * 0.36;
			const cx = 0.50 + Math.cos( th ) * rad * 0.95;
			const cy = 0.48 + Math.sin( th ) * rad * 0.95;
			const l = 0.11 + rng() * 0.05;
			items.push( {
				cx,
				cy,
				angle: Math.atan2( cy - 0.15, cx - 0.50 ) - Math.PI * 0.5 + ( rng() - 0.5 ) * 0.65,
				len: l,
				wid: l * 0.58,
				hue: ( rng() - 0.5 ) * 0.06,
				light: 0.78 + rng() * 0.36,
				kind: 'birch',
			} );

		}
		return items;

	}

	// Oak: 13 realistic lobed oak leaves arranged on forked twiglets (fine botanical detail, zero giant block polygons!)
	items.push( { cx: 0.50, cy: 0.06, angle: 0.04, len: 0.74, wid: 0.011, hue: 0, light: 0.62, kind: 'twig' } );
	items.push( { cx: 0.49, cy: 0.34, angle: - 0.66, len: 0.36, wid: 0.008, hue: 0, light: 0.62, kind: 'twig' } );
	items.push( { cx: 0.51, cy: 0.44, angle: 0.64, len: 0.36, wid: 0.008, hue: 0, light: 0.62, kind: 'twig' } );
	const oakSpots = [
		[ 0.50, 0.72, 0.02, 0.25 ], [ 0.40, 0.66, - 0.58, 0.23 ], [ 0.60, 0.68, 0.56, 0.23 ],
		[ 0.30, 0.52, - 0.96, 0.22 ], [ 0.24, 0.38, - 1.28, 0.20 ], [ 0.38, 0.38, - 0.48, 0.19 ],
		[ 0.70, 0.56, 0.94, 0.22 ], [ 0.76, 0.42, 1.24, 0.20 ], [ 0.62, 0.40, 0.46, 0.19 ],
		[ 0.46, 0.48, - 0.28, 0.20 ], [ 0.55, 0.52, 0.32, 0.20 ], [ 0.36, 0.24, - 1.05, 0.18 ],
		[ 0.64, 0.26, 1.04, 0.18 ],
	];
	for ( const [ sx, sy, ang, l ] of oakSpots ) {

		items.push( {
			cx: sx!,
			cy: sy!,
			angle: ang! + ( rng() - 0.5 ) * 0.24,
			len: l!,
			wid: l! * 0.48,
			hue: ( rng() - 0.5 ) * 0.05,
			light: 0.82 + rng() * 0.34,
			kind: 'oak',
		} );

	}
	return items;

}

/**
 * Generates high-resolution (512px) multi-leaf botanical sprig & fern frond atlases
 * with fine venation, woody twigs, tangent normal relief, and coverage-preserving mipmaps.
 */
export function synthesizeLeafSprigAtlas( preset: FoliageAtlasKind, size = 512, alphaTest = 0.42 ): LeafAtlasResult {

	const rgba = new Uint8Array( size * size * 4 );
	const normalLinear = new Uint8Array( size * size * 4 );
	const ormLinear = new Uint8Array( size * size * 4 );
	const heights = new Float32Array( size * size );
	const specs = buildBotanicalSprigSpec( preset );

	for ( let y = 0; y < size; y ++ ) {

		const v = y / size;
		for ( let x = 0; x < size; x ++ ) {

			const u = x / size;
			const idx = y * size + x;
			const p4 = idx * 4;

			let bestCov = 0;
			let bestVein = 0;
			let bestHue = 0;
			let bestLight = 1;
			let bestAlong = 0;
			let isTwig = false;

			for ( const lf of specs ) {

				const dx = u - lf.cx;
				const dy = v - lf.cy;
				const ca = Math.cos( lf.angle );
				const sa = Math.sin( lf.angle );
				const lx = dx * ca + dy * sa;
				const ly = - dx * sa + dy * ca;

				const tAlong = ly / lf.len;
				if ( tAlong < 0.0 || tAlong > 1.01 ) continue;

				if ( lf.kind === 'twig' ) {

					const tw = lf.wid * ( 1.0 - 0.48 * tAlong );
					if ( Math.abs( lx ) <= tw && ! bestCov ) {

						bestCov = 1;
						bestVein = 1 - Math.abs( lx ) / tw;
						bestHue = 0;
						bestLight = lf.light;
						bestAlong = tAlong;
						isTwig = true;

					}
					continue;

				}

				if ( lf.kind === 'pine' ) {

					const w = lf.wid * ( 1.0 - 0.58 * tAlong );
					if ( Math.abs( lx ) <= w ) {

						bestCov = 1;
						bestVein = 1 - Math.abs( lx ) / w;
						bestHue = lf.hue;
						bestLight = lf.light;
						bestAlong = tAlong;
						isTwig = false;

					}
					continue;

				}

				const baseEnv = Math.sin( Math.pow( clamp01( tAlong ), 0.58 ) * Math.PI );
				const lobeMod = lf.kind === 'oak'
					? ( 0.72 + 0.28 * Math.sin( tAlong * Math.PI * 5.0 ) )
					: lf.kind === 'fernPinna'
						? ( 0.85 + 0.15 * Math.sin( tAlong * Math.PI * 12.0 ) ) * ( 1.08 - 0.42 * tAlong )
						: ( 0.90 + 0.10 * Math.sin( tAlong * Math.PI * 16.0 ) ) * ( 1.06 - 0.34 * tAlong );
				const halfW = lf.wid * baseEnv * lobeMod;
				if ( halfW > 1e-4 && Math.abs( lx ) <= halfW ) {

					const distNorm = Math.abs( lx ) / halfW;
					const midrib = Math.exp( - Math.pow( lx / ( lf.wid * 0.09 ), 2 ) );
					const lateralVein = Math.exp( - Math.pow( Math.sin( ( tAlong * 6.0 - Math.abs( lx ) / Math.max( 0.01, lf.wid ) * 1.4 ) * Math.PI ), 2 ) * 22 ) * ( 1 - distNorm );
					bestCov = 1;
					bestVein = Math.max( midrib, lateralVein * 0.60 );
					bestHue = lf.hue;
					bestLight = lf.light;
					bestAlong = tAlong;
					isTwig = false;

				}

			}

			if ( bestCov > 0 ) {

				const micro = periodicValueNoise2D( u, v, 36, 19 ) * 0.10;
				heights[ idx ] = ( 0.38 + 0.38 * bestVein ) + micro * 0.12;

				let lr: number, lg: number, lb: number;
				if ( isTwig ) {

					lr = 0.12 * bestLight;
					lg = 0.09 * bestLight;
					lb = 0.05 * bestLight;

				} else if ( preset === 'pine' ) {

					lr = ( 0.055 + bestHue * 0.25 + 0.025 * bestAlong ) * bestLight;
					lg = ( 0.145 + 0.048 * bestAlong + bestHue * 0.20 ) * bestLight;
					lb = ( 0.015 + 0.008 * bestAlong ) * bestLight;

				} else if ( preset === 'fern' ) {

					lr = ( 0.095 + 0.050 * bestAlong + bestHue + 0.030 * bestVein ) * bestLight;
					lg = ( 0.235 + 0.075 * bestAlong + bestHue * 0.25 + 0.030 * bestVein ) * bestLight;
					lb = ( 0.014 + 0.008 * bestAlong ) * bestLight;

				} else if ( preset === 'birch' ) {

					lr = ( 0.165 + 0.068 * bestAlong + bestHue + 0.030 * bestVein ) * bestLight;
					lg = ( 0.275 + 0.080 * bestAlong + bestHue * 0.30 + 0.030 * bestVein ) * bestLight;
					lb = ( 0.020 + 0.008 * bestAlong ) * bestLight;

				} else {

					// Oak: lush warm sunlit golden-olive foliage (high chroma, low blue!)
					lr = ( 0.115 + 0.060 * bestAlong + bestHue + 0.030 * bestVein ) * bestLight;
					lg = ( 0.230 + 0.072 * bestAlong + bestHue * 0.25 + 0.030 * bestVein ) * bestLight;
					lb = ( 0.016 + 0.008 * bestAlong ) * bestLight;

				}

				rgba[ p4 ] = Math.round( clamp01( Math.pow( lr, 1 / 2.2 ) ) * 255 );
				rgba[ p4 + 1 ] = Math.round( clamp01( Math.pow( lg, 1 / 2.2 ) ) * 255 );
				rgba[ p4 + 2 ] = Math.round( clamp01( Math.pow( lb, 1 / 2.2 ) ) * 255 );
				rgba[ p4 + 3 ] = 255;

				ormLinear[ p4 ] = Math.round( ( 0.76 + 0.24 * bestVein ) * 255 );
				ormLinear[ p4 + 1 ] = Math.round( ( isTwig ? 0.85 : 0.46 - 0.10 * bestVein ) * 255 );
				ormLinear[ p4 + 2 ] = 0;
				ormLinear[ p4 + 3 ] = 255;

			} else {

				rgba[ p4 ] = preset === 'pine' ? 38 : preset === 'birch' ? 78 : 58;
				rgba[ p4 + 1 ] = preset === 'pine' ? 84 : preset === 'birch' ? 128 : 104;
				rgba[ p4 + 2 ] = 30;
				rgba[ p4 + 3 ] = 0;

				ormLinear[ p4 ] = 200;
				ormLinear[ p4 + 1 ] = 128;
				ormLinear[ p4 + 2 ] = 0;
				ormLinear[ p4 + 3 ] = 255;

			}

		}

	}

	for ( let y = 0; y < size; y ++ ) {

		const ym1 = Math.max( 0, y - 1 );
		const yp1 = Math.min( size - 1, y + 1 );
		for ( let x = 0; x < size; x ++ ) {

			const xm1 = Math.max( 0, x - 1 );
			const xp1 = Math.min( size - 1, x + 1 );
			const idx = y * size + x;
			const dhx = ( heights[ y * size + xp1 ]! - heights[ y * size + xm1 ]! ) * 5.0;
			const dhy = ( heights[ yp1 * size + x ]! - heights[ ym1 * size + x ]! ) * 5.0;
			const l = Math.hypot( - dhx, - dhy, 1 ) || 1;
			const p4 = idx * 4;
			normalLinear[ p4 ] = Math.round( ( ( - dhx / l ) * 0.5 + 0.5 ) * 255 );
			normalLinear[ p4 + 1 ] = Math.round( ( ( - dhy / l ) * 0.5 + 0.5 ) * 255 );
			normalLinear[ p4 + 2 ] = Math.round( ( ( 1 / l ) * 0.5 + 0.5 ) * 255 );
			normalLinear[ p4 + 3 ] = 255;

		}

	}

	const albedoMips = buildCoveragePreservingMipmaps( size, size, rgba, alphaTest );
	return { size, albedoMips, normalLinear, ormLinear };

}
