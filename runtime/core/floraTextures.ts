/**
 * Pure-data Procedural PBR Texture Generators (`Surface::shaped` Bark, Soil,
 * Detailed Veined Leaf Sprig Atlases + Coverage-Preserving Mipmaps).
 * Zero DOM / Zero Three.js dependencies.
 */

import { periodicFbm2D, periodicValueNoise2D, periodicWorley2D } from './prng.ts';
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

export function synthesizeBarkSurface( preset: TreePresetId, size = 256, seed = 42 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		1.6,
		( u, v ) => {

			if ( preset === 'birch' ) {

				const lenticel = Math.exp( - Math.pow( Math.sin( v * Math.PI * 16 + periodicFbm2D( u, v, 4, 2, seed ) * 1.4 ), 2 ) * 22 );
				const roughBase = periodicFbm2D( u, v, 6, 4, seed + 13 );
				const h = - 0.007 * lenticel + 0.010 * ( roughBase - 0.5 );
				return [ h, lenticel ];

			}
			if ( preset === 'pine' ) {

				const plate = periodicWorley2D( u * 1.0, v * 0.5, 7, seed + 5 );
				const fissure = Math.max( 0, 1 - plate * 3.5 );
				const scaleDetail = periodicFbm2D( u, v, 10, 3, seed + 17 );
				const h = - 0.026 * fissure + 0.010 * ( scaleDetail - 0.5 );
				return [ h, fissure ];

			}
			// Oak furrowed bark ridges (natural warm brown-grey, never stark zebra stripes!)
			const warp = periodicFbm2D( u, v, 4, 3, seed ) * 0.14;
			const ridge = Math.sin( ( u + warp ) * Math.PI * 10 );
			const crossCrack = periodicFbm2D( u, ( v * 2.0 ) % 1.0, 8, 4, seed + 23 );
			const h = 0.022 * ( 0.55 * ridge + 0.45 * ( crossCrack - 0.5 ) );
			return [ h, 0.5 + 0.5 * ridge ];

		},
		( _u, _v, r ) => {

			const cavity = clamp01( 0.78 + r.medium * 10 + r.broad * 4 );
			const wear = clamp01( r.medium * 14 + r.fine * 18 );

			if ( preset === 'birch' ) {

				const isBand = r.tag > 0.58;
				const papery = 0.76 + 0.10 * cavity;
				return {
					color: isBand
						? [ 0.22, 0.19, 0.17 ]
						: [ papery * 0.96, papery * 0.94, papery * 0.89 ],
					alpha: 1,
					roughness: isBand ? 0.90 : clamp01( 0.76 - 0.10 * wear ),
					metalness: 0,
					cavity,
				};

			}
			if ( preset === 'pine' ) {

				const darkCrevice = r.tag * 0.55;
				return {
					color: [
						( 0.36 * ( 1 - darkCrevice ) + 0.05 * wear ) * cavity,
						( 0.22 * ( 1 - darkCrevice ) + 0.03 * wear ) * cavity,
						( 0.15 * ( 1 - darkCrevice ) + 0.02 * wear ) * cavity,
					],
					alpha: 1,
					roughness: clamp01( 0.88 - 0.10 * wear + 0.06 * darkCrevice ),
					metalness: 0,
					cavity,
				};

			}
			return {
				color: [
					0.29 * ( 0.65 + 0.35 * cavity ) + 0.03 * wear,
					0.24 * ( 0.65 + 0.35 * cavity ) + 0.025 * wear,
					0.19 * ( 0.65 + 0.35 * cavity ) + 0.02 * wear,
				],
				alpha: 1,
				roughness: clamp01( 0.90 - 0.10 * wear ),
				metalness: 0,
				cavity,
			};

		},
	);

}

export function synthesizeSoilSurface( size = 256, seed = 77 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		1.8,
		( u, v ) => {

			const broad = periodicFbm2D( u, v, 4, 4, seed );
			const grit = periodicFbm2D( u, v, 16, 3, seed + 19 );
			return [ 0.026 * ( broad - 0.5 ) + 0.012 * ( grit - 0.5 ), grit ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.78 + r.medium * 12 + r.broad * 4 );
			const mossPatch = clamp01( ( periodicFbm2D( u, v, 4, 3, seed + 99 ) - 0.34 ) * 2.6 );
			const clover = clamp01( ( periodicFbm2D( u, v, 12, 2, seed + 151 ) - 0.50 ) * 3.0 );
			const litter = clamp01( ( r.tag - 0.65 ) * 2.2 );
			const greenBlend = clamp01( mossPatch * 0.75 + clover * 0.45 );
			return {
				color: [
					( 0.14 * ( 1 - greenBlend ) + 0.08 * greenBlend + 0.05 * litter ) * cavity,
					( 0.11 * ( 1 - greenBlend ) + 0.19 * greenBlend + 0.03 * litter ) * cavity,
					( 0.07 * ( 1 - greenBlend ) + 0.04 * greenBlend + 0.02 * litter ) * cavity,
				],
				alpha: 1,
				roughness: clamp01( 0.92 - 0.08 * greenBlend ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Surface::shaped Carved Travertine / Limestone PBR for the Fountain (喷泉).
 * Smooth warm cream-buff limestone with sedimentary bedding veins & fine chisel micro-grain (no polka dots!).
 */
export function synthesizeCarvedLimestoneSurface( size = 256, seed = 61 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		2.0,
		( u, v ) => {

			const warp = periodicFbm2D( u, v, 3, 3, seed ) * 0.25;
			const strata = Math.sin( ( v + warp * 0.3 ) * Math.PI * 12 ) * 0.004;
			const mineral = ( periodicFbm2D( u, v, 8, 4, seed + 17 ) - 0.5 ) * 0.008;
			const micro = ( periodicValueNoise2D( u, v, 28, seed + 31 ) - 0.5 ) * 0.003;
			return [ strata + mineral + micro, mineral > 0.0015 ? 1 : 0 ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.84 + r.medium * 10 + r.broad * 3 );
			const wear = clamp01( r.medium * 14 + r.fine * 22 );
			const vein = periodicFbm2D( u * 1.0, v * 0.5, 4, 3, seed + 41 );
			const grain = periodicValueNoise2D( u, v, 32, seed + 59 );
			const stoneBase = ( 0.66 + 0.08 * vein + 0.06 * wear + 0.03 * ( grain - 0.5 ) ) * cavity;
			return {
				color: [
					stoneBase * 1.00,
					stoneBase * 0.95,
					stoneBase * 0.86,
				],
				alpha: 1,
				roughness: clamp01( 0.68 - 0.16 * wear ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Surface::shaped Cleaved Bluestone / Slate Granite PBR for the Flagstone Path (石板路).
 * Natural cleaved mineral veins & crystalline granite grain (no circular polka-dot holes!).
 */
export function synthesizeFlagstoneSlateSurface( size = 256, seed = 83 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		1.8,
		( u, v ) => {

			const warpU = ( periodicFbm2D( u, v, 3, 3, seed ) - 0.5 ) * 0.28;
			const warpV = ( periodicFbm2D( u, v, 3, 3, seed + 9 ) - 0.5 ) * 0.28;
			const cleavage = ( periodicFbm2D( u + warpU * 0.2, v + warpV * 0.2, 5, 4, seed + 19 ) - 0.5 ) * 0.018;
			// Ridged mineral fracture vein instead of circular dots
			const veinDist = Math.abs( periodicFbm2D( u + warpU, v + warpV, 4, 3, seed + 37 ) - 0.5 );
			const vein = - 0.010 * Math.max( 0, 1 - veinDist * 14 );
			const grit = ( periodicValueNoise2D( u, v, 28, seed + 53 ) - 0.5 ) * 0.005;
			return [ cleavage + vein + grit, veinDist < 0.04 ? 1 : 0 ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.80 + r.medium * 12 + r.broad * 4 );
			const wear = clamp01( r.medium * 16 + r.fine * 24 );
			const fleck = periodicValueNoise2D( u, v, 34, seed + 71 ) > 0.76 ? 0.07 : 0.0;
			const warmShift = periodicFbm2D( u, v, 3, 2, seed + 93 );
			const base = ( 0.36 + 0.10 * wear + fleck ) * cavity;
			const mossEdge = r.tag > 0.5 ? 0.22 : 0;
			return {
				color: [
					( base * ( 0.90 + 0.18 * warmShift ) ) * ( 1 - mossEdge ) + 0.14 * mossEdge,
					( base * ( 0.94 + 0.10 * warmShift ) ) * ( 1 - mossEdge ) + 0.22 * mossEdge,
					( base * 1.02 ) * ( 1 - mossEdge ) + 0.09 * mossEdge,
				],
				alpha: 1,
				roughness: clamp01( 0.74 - 0.18 * wear + 0.16 * mossEdge ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Surface::shaped Stratified Taihu / Granite Rockery PBR (假山多层岩石 + 裂隙纹理 + 苔藓 + 石英微粒).
 * Uses domain-warped ridge cracks and sedimentary strata — zero artificial polka dots.
 */
export function synthesizeScholarRockSurface( size = 512, seed = 109 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		2.8,
		( u, v ) => {

			const wU = ( periodicFbm2D( u, v, 3, 3, seed ) - 0.5 ) * 0.36;
			const wV = ( periodicFbm2D( u, v, 3, 3, seed + 13 ) - 0.5 ) * 0.36;
			// Sedimentary karst strata warped organically
			const strata = Math.sin( ( v + wV * 0.55 ) * Math.PI * 10 ) * 0.016;
			const broad = ( periodicFbm2D( u + wU * 0.25, v + wV * 0.25, 4, 4, seed + 7 ) - 0.5 ) * 0.055;
			// Sharp branching fracture crevices (ridged FBM, NOT circular Worley spots!)
			const ridgeA = Math.abs( periodicFbm2D( u + wU, v + wV, 5, 3, seed + 23 ) - 0.5 );
			const ridgeB = Math.abs( periodicFbm2D( u - wV * 0.6, v + wU * 0.6, 8, 3, seed + 41 ) - 0.5 );
			const crack = - 0.028 * Math.max( 0, 1 - ridgeA * 15 ) - 0.016 * Math.max( 0, 1 - ridgeB * 18 );
			const crystalline = ( periodicFbm2D( u, v, 20, 3, seed + 53 ) - 0.5 ) * 0.012;
			return [ strata + broad + crack + crystalline, Math.max( 0, 1 - ridgeA * 12 ) ];

		},
		( u, v, r ) => {

			const cavity = clamp01( 0.72 + r.medium * 14 + r.broad * 5 );
			const wear = clamp01( r.medium * 20 + r.fine * 28 );
			const quartz = periodicValueNoise2D( u, v, 42, seed + 89 ) > 0.80 ? 0.12 : 0;
			const calciteVein = clamp01( ( r.tag - 0.68 ) * 2.4 );
			const lichen = clamp01( ( periodicFbm2D( u, v, 6, 3, seed + 131 ) - 0.58 ) * 2.5 ) * ( 1 - calciteVein );
			const mossMask = clamp01( ( periodicFbm2D( u, v, 4, 3, seed + 177 ) - 0.48 ) * 2.4 ) * clamp01( 0.6 - r.medium * 10 );
			const stone = ( 0.34 + 0.13 * wear + quartz + 0.14 * calciteVein ) * cavity;
			return {
				color: [
					stone * ( 1 - mossMask ) * ( 1 - lichen * 0.25 ) + 0.12 * mossMask + 0.22 * lichen,
					stone * ( 1 - mossMask ) * ( 1 - lichen * 0.10 ) + 0.23 * mossMask + 0.28 * lichen,
					stone * ( 1 - mossMask ) * ( 1 - lichen * 0.35 ) + 0.07 * mossMask + 0.14 * lichen,
				],
				alpha: 1,
				roughness: clamp01( 0.78 - 0.22 * wear + 0.14 * mossMask - 0.10 * quartz ),
				metalness: 0,
				cavity,
			};

		},
	);

}

/**
 * Seamless Periodic Water Ripple Normal Map (linear tangent space RGB) for animated lake & fountain pools.
 */
export function synthesizeWaterNormalMap( size = 256, seed = 149 ): Uint8Array {

	const heights = new Float32Array( size * size );
	for ( let y = 0; y < size; y ++ ) {

		const v = y / size;
		for ( let x = 0; x < size; x ++ ) {

			const u = x / size;
			const w1 = periodicFbm2D( u, v, 6, 3, seed );
			const w2 = Math.sin( ( u * 4 + v * 2 ) * Math.PI * 2 ) * 0.18;
			const w3 = Math.cos( ( u * 3 - v * 5 ) * Math.PI * 2 ) * 0.14;
			heights[ y * size + x ] = w1 * 0.68 + w2 + w3;

		}

	}

	const out = new Uint8Array( size * size * 4 );
	const strength = 5.5;
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

export interface LeafAtlasResult {
	size: number;
	albedoMips: MipLevel[];
	normalLinear: Uint8Array;
	ormLinear: Uint8Array;
}

/**
 * Generates compact full rosette leaf clusters & radiating conifer needle tufts
 * (no dangling bottom twig stick) with tangent normal relief and coverage-preserving mipmaps.
 */
export function synthesizeLeafSprigAtlas( preset: TreePresetId, size = 256, alphaTest = 0.45 ): LeafAtlasResult {

	const rgba = new Uint8Array( size * size * 4 );
	const normalLinear = new Uint8Array( size * size * 4 );
	const ormLinear = new Uint8Array( size * size * 4 );
	const heights = new Float32Array( size * size );

	const leafPositions: Array<{ cx: number; cy: number; angle: number; len: number; wid: number; hue: number }> = preset === 'pine'
		? Array.from( { length: 28 }, ( _, i ) => {

			const ang = ( i / 28 ) * Math.PI * 2 + ( i % 2 ) * 0.2;
			return {
				cx: 0.5 + Math.cos( ang ) * 0.05,
				cy: 0.5 + Math.sin( ang ) * 0.05,
				angle: ang - Math.PI * 0.5,
				len: 0.36 + ( i % 3 ) * 0.04,
				wid: 0.022,
				hue: ( ( i % 5 ) - 2 ) * 0.015,
			};

		} )
		: [
			{ cx: 0.50, cy: 0.50, angle: 0.00, len: 0.36, wid: 0.22, hue: 0.02 },
			{ cx: 0.50, cy: 0.50, angle: 1.05, len: 0.34, wid: 0.21, hue: - 0.02 },
			{ cx: 0.50, cy: 0.50, angle: - 1.05, len: 0.34, wid: 0.21, hue: 0.03 },
			{ cx: 0.50, cy: 0.50, angle: 2.15, len: 0.32, wid: 0.20, hue: - 0.01 },
			{ cx: 0.50, cy: 0.50, angle: - 2.15, len: 0.32, wid: 0.20, hue: 0.04 },
			{ cx: 0.50, cy: 0.50, angle: 3.14, len: 0.30, wid: 0.19, hue: 0.00 },
		];

	for ( let y = 0; y < size; y ++ ) {

		const v = y / size;
		for ( let x = 0; x < size; x ++ ) {

			const u = x / size;
			const idx = y * size + x;
			const p4 = idx * 4;

			let bestCov = 0;
			let bestVein = 0;
			let bestHue = 0;
			let bestAlong = 0;

			for ( const lf of leafPositions ) {

				const dx = u - lf.cx;
				const dy = v - lf.cy;
				const ca = Math.cos( lf.angle );
				const sa = Math.sin( lf.angle );
				const lx = dx * ca + dy * sa;
				const ly = - dx * sa + dy * ca;

				const tAlong = ly / lf.len;
				if ( tAlong < 0.0 || tAlong > 1.02 ) continue;

				if ( preset === 'pine' ) {

					const dist = Math.abs( lx );
					const w = lf.wid * ( 1.0 - 0.60 * tAlong );
					if ( dist < w && tAlong <= 1 ) {

						bestCov = 1;
						bestVein = 1 - dist / w;
						bestHue = lf.hue;
						bestAlong = tAlong;

					}

				} else {

					const baseEnv = Math.sin( Math.pow( clamp01( tAlong ), 0.62 ) * Math.PI );
					const lobeMod = preset === 'oak'
						? ( 0.78 + 0.22 * Math.sin( tAlong * Math.PI * 5.0 ) )
						: ( 0.92 + 0.08 * Math.sin( tAlong * Math.PI * 14.0 ) ) * ( 1.05 - 0.30 * tAlong );
					const halfW = lf.wid * baseEnv * lobeMod;
					if ( halfW > 1e-4 && Math.abs( lx ) <= halfW && tAlong <= 1 ) {

						const distNorm = Math.abs( lx ) / halfW;
						const midrib = Math.exp( - Math.pow( lx / ( lf.wid * 0.09 ), 2 ) );
						const lateralVein = Math.exp( - Math.pow( Math.sin( ( tAlong * 5.5 - Math.abs( lx ) * 4.2 ) * Math.PI ), 2 ) * 22 ) * ( 1 - distNorm );
						bestCov = 1;
						bestVein = Math.max( midrib, lateralVein * 0.65 );
						bestHue = lf.hue;
						bestAlong = tAlong;

					}

				}

			}

			if ( bestCov > 0 ) {

				const micro = periodicValueNoise2D( u, v, 32, 19 ) * 0.12;
				heights[ idx ] = ( 0.4 + 0.35 * bestVein ) + micro * 0.15;

				let lr: number, lg: number, lb: number;
				if ( preset === 'pine' ) {

					// Rich deep spruce/pine forest green
					lr = 0.05 + bestHue * 0.4 + 0.03 * bestAlong;
					lg = 0.17 + 0.06 * bestAlong + bestHue * 0.3;
					lb = 0.04 + 0.02 * bestAlong;

				} else if ( preset === 'birch' ) {

					lr = 0.14 + 0.07 * bestAlong + bestHue + 0.05 * bestVein;
					lg = 0.34 + 0.10 * bestAlong + bestHue * 0.4 + 0.04 * bestVein;
					lb = 0.07 + 0.02 * bestAlong;

				} else {

					// Deep lush oak canopy emerald green
					lr = 0.09 + 0.05 * bestAlong + bestHue + 0.05 * bestVein;
					lg = 0.25 + 0.08 * bestAlong + bestHue * 0.3 + 0.05 * bestVein;
					lb = 0.05 + 0.02 * bestAlong;

				}

				rgba[ p4 ] = Math.round( clamp01( Math.pow( lr, 1 / 2.2 ) ) * 255 );
				rgba[ p4 + 1 ] = Math.round( clamp01( Math.pow( lg, 1 / 2.2 ) ) * 255 );
				rgba[ p4 + 2 ] = Math.round( clamp01( Math.pow( lb, 1 / 2.2 ) ) * 255 );
				rgba[ p4 + 3 ] = 255;

				ormLinear[ p4 ] = Math.round( ( 0.78 + 0.22 * bestVein ) * 255 );
				ormLinear[ p4 + 1 ] = Math.round( ( 0.44 - 0.10 * bestVein ) * 255 );
				ormLinear[ p4 + 2 ] = 0;
				ormLinear[ p4 + 3 ] = 255;

			} else {

				// Edge-dilated chlorophyll bleed prevents dark filtering halos
				rgba[ p4 ] = preset === 'pine' ? 42 : preset === 'birch' ? 84 : 62;
				rgba[ p4 + 1 ] = preset === 'pine' ? 92 : preset === 'birch' ? 142 : 114;
				rgba[ p4 + 2 ] = 36;
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
			const dhx = ( heights[ y * size + xp1 ]! - heights[ y * size + xm1 ]! ) * 4.5;
			const dhy = ( heights[ yp1 * size + x ]! - heights[ ym1 * size + x ]! ) * 4.5;
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
