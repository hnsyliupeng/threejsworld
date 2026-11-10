/**
 * Pure-data Surface::shaped multi-scale relief PBR texture synthesizer & coverage-preserving mipmaps.
 * Fuses solstice-procgen (`surface.rs`) + vegetation (`textureMipmaps.ts`).
 */

import { periodicFbm2D, periodicWorley2D } from './prng.ts';

export interface ReliefSample {
	heightMetres: number;
	fine: number;
	medium: number;
	broad: number;
	tag: number;
}

export interface ShadeResult {
	color: [ number, number, number ];
	alpha: number;
	roughness: number;
	metalness: number;
	cavity: number;
}

export interface ShapedSurfaceBuffers {
	width: number;
	height: number;
	tileMetres: number;
	albedoSRGB: Uint8Array;
	normalLinear: Uint8Array;
	ormLinear: Uint8Array;
}

export interface MipLevel {
	level: number;
	width: number;
	height: number;
	coverage: number;
	data: Uint8Array;
}

function clamp01( x: number ): number {

	return x < 0 ? 0 : x > 1 ? 1 : x;

}

function boxBlurPeriodic( grid: Float32Array, size: number, radius: number ): Float32Array {

	if ( radius <= 0 ) return new Float32Array( grid );
	const horiz = new Float32Array( size * size );
	const win = 2 * radius + 1;
	for ( let y = 0; y < size; y ++ ) {

		const row = y * size;
		let acc = 0;
		for ( let dx = - radius; dx <= radius; dx ++ ) {

			acc += grid[ row + ( ( ( dx % size ) + size ) % size ) ]!;

		}
		for ( let x = 0; x < size; x ++ ) {

			horiz[ row + x ] = acc / win;
			const addX = ( x + radius + 1 ) % size;
			const remX = ( ( ( x - radius ) % size ) + size ) % size;
			acc += grid[ row + addX ]! - grid[ row + remX ]!;

		}

	}
	const out = new Float32Array( size * size );
	for ( let x = 0; x < size; x ++ ) {

		let acc = 0;
		for ( let dy = - radius; dy <= radius; dy ++ ) {

			acc += horiz[ ( ( ( dy % size ) + size ) % size ) * size + x ]!;

		}
		for ( let y = 0; y < size; y ++ ) {

			out[ y * size + x ] = acc / win;
			const addY = ( y + radius + 1 ) % size;
			const remY = ( ( ( y - radius ) % size ) + size ) % size;
			acc += horiz[ addY * size + x ]! - horiz[ remY * size + x ]!;

		}

	}
	return out;

}

export function synthesizeShapedSurface(
	size: number,
	tileMetres: number,
	heightFn: ( u: number, v: number ) => [ number, number ],
	shadeFn: ( u: number, v: number, relief: ReliefSample ) => ShadeResult,
): ShapedSurfaceBuffers {

	const heights = new Float32Array( size * size );
	const tags = new Float32Array( size * size );

	for ( let y = 0; y < size; y ++ ) {

		const v = y / size;
		for ( let x = 0; x < size; x ++ ) {

			const u = x / size;
			const [ h, tag ] = heightFn( u, v );
			const idx = y * size + x;
			heights[ idx ] = h;
			tags[ idx ] = tag;

		}

	}

	const pxPerM = size / Math.max( 0.05, tileMetres );
	const rFine = Math.min( Math.floor( size / 4 ), Math.max( 1, Math.round( 0.02 * pxPerM ) ) );
	const rMed = Math.min( Math.floor( size / 3 ), Math.max( 2, Math.round( 0.10 * pxPerM ) ) );
	const rBroad = Math.min( Math.floor( size / 2 ), Math.max( 3, Math.round( 0.50 * pxPerM ) ) );

	const avgFine = boxBlurPeriodic( heights, size, rFine );
	const avgMed = boxBlurPeriodic( heights, size, rMed );
	const avgBroad = boxBlurPeriodic( heights, size, rBroad );

	const albedoSRGB = new Uint8Array( size * size * 4 );
	const normalLinear = new Uint8Array( size * size * 4 );
	const ormLinear = new Uint8Array( size * size * 4 );
	const texelM = tileMetres / size;

	for ( let y = 0; y < size; y ++ ) {

		const v = y / size;
		const ym1 = ( y - 1 + size ) % size;
		const yp1 = ( y + 1 ) % size;
		for ( let x = 0; x < size; x ++ ) {

			const u = x / size;
			const xm1 = ( x - 1 + size ) % size;
			const xp1 = ( x + 1 ) % size;
			const idx = y * size + x;
			const h = heights[ idx ]!;

			const relief: ReliefSample = {
				heightMetres: h,
				fine: h - avgFine[ idx ]!,
				medium: h - avgMed[ idx ]!,
				broad: h - avgBroad[ idx ]!,
				tag: tags[ idx ]!,
			};
			const shaded = shadeFn( u, v, relief );

			const dhDx = ( heights[ y * size + xp1 ]! - heights[ y * size + xm1 ]! ) / ( 2 * texelM );
			const dhDy = ( heights[ yp1 * size + x ]! - heights[ ym1 * size + x ]! ) / ( 2 * texelM );
			const len = Math.hypot( - dhDx, - dhDy, 1 ) || 1;

			const p4 = idx * 4;
			albedoSRGB[ p4 ] = Math.round( clamp01( Math.pow( shaded.color[ 0 ], 1 / 2.2 ) ) * 255 );
			albedoSRGB[ p4 + 1 ] = Math.round( clamp01( Math.pow( shaded.color[ 1 ], 1 / 2.2 ) ) * 255 );
			albedoSRGB[ p4 + 2 ] = Math.round( clamp01( Math.pow( shaded.color[ 2 ], 1 / 2.2 ) ) * 255 );
			albedoSRGB[ p4 + 3 ] = Math.round( clamp01( shaded.alpha ) * 255 );

			normalLinear[ p4 ] = Math.round( ( ( - dhDx / len ) * 0.5 + 0.5 ) * 255 );
			normalLinear[ p4 + 1 ] = Math.round( ( ( - dhDy / len ) * 0.5 + 0.5 ) * 255 );
			normalLinear[ p4 + 2 ] = Math.round( ( ( 1 / len ) * 0.5 + 0.5 ) * 255 );
			normalLinear[ p4 + 3 ] = 255;

			ormLinear[ p4 ] = Math.round( clamp01( shaded.cavity ) * 255 );
			ormLinear[ p4 + 1 ] = Math.round( clamp01( shaded.roughness ) * 255 );
			ormLinear[ p4 + 2 ] = Math.round( clamp01( shaded.metalness ) * 255 );
			ormLinear[ p4 + 3 ] = 255;

		}

	}

	return { width: size, height: size, tileMetres, albedoSRGB, normalLinear, ormLinear };

}

export function granitePresetSurface( size = 128, seed = 42, mossCoverage = 0.25 ): ShapedSurfaceBuffers {

	return synthesizeShapedSurface(
		size,
		2.5,
		( u, v ) => {

			const broad = periodicFbm2D( u, v, 4, 4, seed );
			const crackD = periodicWorley2D( u, v, 6, seed + 29 );
			const crack = - 0.045 * Math.max( 0, 1 - crackD * 5 );
			return [ 0.09 * ( broad - 0.5 ) + crack, broad ];

		},
		( _u, _v, r ) => {

			const cavity = clamp01( 0.75 + r.medium * 14 + r.broad * 4 );
			const wear = clamp01( r.medium * 22 + r.fine * 30 );
			const stone = 0.42 * cavity + 0.10 * wear;
			const moss = clamp01( ( mossCoverage - 0.1 + ( - r.medium * 18 ) ) * ( 1 - wear ) );
			return {
				color: [
					stone * ( 1 - moss ) + 0.24 * moss,
					stone * ( 1 - moss ) + 0.42 * moss,
					stone * ( 1 - moss ) + 0.14 * moss,
				],
				alpha: 1,
				roughness: clamp01( 0.84 - 0.16 * wear + 0.10 * moss ),
				metalness: 0,
				cavity,
			};

		},
	);

}

export function computeAlphaCoverageRatio( rgba: Uint8Array, alphaTest: number ): number {

	const thresh = Math.ceil( alphaTest * 255 );
	const total = rgba.length / 4;
	if ( total === 0 ) return 0;
	let covered = 0;
	for ( let i = 3; i < rgba.length; i += 4 ) {

		if ( rgba[ i ]! >= thresh ) covered ++;

	}
	return covered / total;

}

export function buildCoveragePreservingMipmaps(
	width: number,
	height: number,
	rgba: Uint8Array,
	alphaTest = 0.45,
): MipLevel[] {

	const targetCov = computeAlphaCoverageRatio( rgba, alphaTest );
	const thresh = Math.ceil( alphaTest * 255 );
	const mips: MipLevel[] = [
		{ level: 0, width, height, coverage: targetCov, data: new Uint8Array( rgba ) },
	];

	let cw = width;
	let ch = height;
	let cur = new Uint8Array( rgba );
	let level = 0;

	while ( cw > 1 || ch > 1 ) {

		level ++;
		const nw = Math.max( 1, Math.floor( cw / 2 ) );
		const nh = Math.max( 1, Math.floor( ch / 2 ) );
		const out = new Uint8Array( nw * nh * 4 );

		for ( let y = 0; y < nh; y ++ ) {

			const sy0 = Math.min( ch - 1, y * 2 );
			const sy1 = Math.min( ch - 1, sy0 + 1 );
			for ( let x = 0; x < nw; x ++ ) {

				const sx0 = Math.min( cw - 1, x * 2 );
				const sx1 = Math.min( cw - 1, sx0 + 1 );
				const offs = [
					( sy0 * cw + sx0 ) * 4,
					( sy0 * cw + sx1 ) * 4,
					( sy1 * cw + sx0 ) * 4,
					( sy1 * cw + sx1 ) * 4,
				];
				const aSum = cur[ offs[ 0 ]! + 3 ]! + cur[ offs[ 1 ]! + 3 ]! + cur[ offs[ 2 ]! + 3 ]! + cur[ offs[ 3 ]! + 3 ]!;
				const dst = ( y * nw + x ) * 4;
				for ( let c = 0; c < 3; c ++ ) {

					if ( aSum > 0 ) {

						out[ dst + c ] = Math.round(
							( cur[ offs[ 0 ]! + c ]! * cur[ offs[ 0 ]! + 3 ]! +
							  cur[ offs[ 1 ]! + c ]! * cur[ offs[ 1 ]! + 3 ]! +
							  cur[ offs[ 2 ]! + c ]! * cur[ offs[ 2 ]! + 3 ]! +
							  cur[ offs[ 3 ]! + c ]! * cur[ offs[ 3 ]! + 3 ]! ) / aSum,
						);

					}

				}
				out[ dst + 3 ] = Math.round( aSum * 0.25 );

			}

		}

		if ( targetCov > 0 ) {

			const nPx = nw * nh;
			const targetCount = Math.round( targetCov * nPx );
			const hist = new Uint32Array( 256 );
			for ( let i = 3; i < out.length; i += 4 ) hist[ out[ i ]! ]! ++;

			let lo = 0;
			let hi = 255;
			let bestS = 1;
			let bestErr = nPx + 1;
			for ( let iter = 0; iter < 32; iter ++ ) {

				const mid = ( lo + hi ) * 0.5;
				let cov = 0;
				for ( let a = 1; a < 256; a ++ ) {

					if ( Math.min( 255, Math.round( a * mid ) ) >= thresh ) cov += hist[ a ]!;

				}
				const err = Math.abs( cov - targetCount );
				if ( err < bestErr ) {

					bestErr = err;
					bestS = mid;

				}
				if ( err === 0 ) break;
				if ( cov < targetCount ) lo = mid;
				else hi = mid;

			}
			for ( let i = 3; i < out.length; i += 4 ) {

				out[ i ] = Math.min( 255, Math.round( out[ i ]! * bestS ) );

			}

			if ( bestErr > Math.max( 1, Math.round( nPx * 0.002 ) ) ) {

				const scaledHist = new Uint32Array( 256 );
				for ( let i = 3; i < out.length; i += 4 ) scaledHist[ out[ i ]! ]! ++;
				let cutoff = 255;
				let above = 0;
				while ( cutoff > 0 && above + scaledHist[ cutoff ]! < targetCount ) {

					above += scaledHist[ cutoff ]!;
					cutoff --;

				}
				let raiseAtCutoff = targetCount - above;
				for ( let i = 3; i < out.length; i += 4 ) {

					const a = out[ i ]!;
					if ( a === 0 ) continue;
					if ( a > cutoff ) out[ i ] = Math.max( a, thresh );
					else if ( a < cutoff ) out[ i ] = Math.min( a, thresh - 1 );
					else if ( raiseAtCutoff > 0 ) {

						out[ i ] = Math.max( a, thresh );
						raiseAtCutoff --;

					} else out[ i ] = Math.min( a, thresh - 1 );

				}

			}

		}

		cw = nw;
		ch = nh;
		cur = out;
		mips.push( { level, width: cw, height: ch, coverage: computeAlphaCoverageRatio( cur, alphaTest ), data: cur } );

	}

	return mips;

}
