/**
 * Deterministic PRNG, spatial hashing, and strictly periodic noise primitives.
 * Zero DOM / Zero Three.js dependencies: byte-identical across Node, Workers, WebGL2, WebGPU.
 */

export class Mulberry32 {
	private state: number;

	constructor( seed: number ) {

		this.state = ( seed >>> 0 ) || 1;

	}

	next(): number {

		let t = ( this.state += 0x6D2B79F5 );
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	}

	range( min: number, max: number ): number {

		return min + ( max - min ) * this.next();

	}

	signed(): number {

		return this.next() * 2 - 1;

	}

}

export function hash2D( ix: number, iy: number, seed: number ): number {

	let h = Math.imul( ix | 0, 374761393 ) + Math.imul( iy | 0, 668265263 ) + Math.imul( seed | 0, 1442695041 );
	h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
	h ^= h >>> 16;
	return ( h >>> 0 ) / 4294967296;

}

export function smoothstep( edge0: number, edge1: number, x: number ): number {

	const t = Math.max( 0, Math.min( 1, ( x - edge0 ) / Math.max( 1e-8, edge1 - edge0 ) ) );
	return t * t * ( 3 - 2 * t );

}

export function periodicValueNoise2D( u: number, v: number, period: number, seed: number ): number {

	const p = Math.max( 1, Math.floor( period ) );
	const x = ( ( u % 1 + 1 ) % 1 ) * p;
	const y = ( ( v % 1 + 1 ) % 1 ) * p;
	const x0 = Math.floor( x );
	const y0 = Math.floor( y );
	const fx = x - x0;
	const fy = y - y0;
	const sx = fx * fx * ( 3 - 2 * fx );
	const sy = fy * fy * ( 3 - 2 * fy );

	const ix0 = ( ( x0 % p ) + p ) % p;
	const iy0 = ( ( y0 % p ) + p ) % p;
	const ix1 = ( ix0 + 1 ) % p;
	const iy1 = ( iy0 + 1 ) % p;

	const n00 = hash2D( ix0, iy0, seed );
	const n10 = hash2D( ix1, iy0, seed );
	const n01 = hash2D( ix0, iy1, seed );
	const n11 = hash2D( ix1, iy1, seed );

	const nx0 = n00 + ( n10 - n00 ) * sx;
	const nx1 = n01 + ( n11 - n01 ) * sx;
	return nx0 + ( nx1 - nx0 ) * sy;

}

export function periodicFbm2D( u: number, v: number, basePeriod: number, octaves: number, seed: number ): number {

	let val = 0;
	let amp = 0.5;
	let norm = 0;
	let freq = basePeriod;
	for ( let o = 0; o < octaves; o ++ ) {

		val += amp * periodicValueNoise2D( u, v, freq, seed + o * 97 );
		norm += amp;
		amp *= 0.5;
		freq *= 2;

	}
	return val / Math.max( 1e-8, norm );

}

export function periodicWorley2D( u: number, v: number, cells: number, seed: number ): number {

	const c = Math.max( 1, Math.floor( cells ) );
	const x = ( ( u % 1 + 1 ) % 1 ) * c;
	const y = ( ( v % 1 + 1 ) % 1 ) * c;
	const cx = Math.floor( x );
	const cy = Math.floor( y );
	let minD = 99;
	for ( let dy = - 1; dy <= 1; dy ++ ) {

		for ( let dx = - 1; dx <= 1; dx ++ ) {

			const nx = ( ( ( cx + dx ) % c ) + c ) % c;
			const ny = ( ( ( cy + dy ) % c ) + c ) % c;
			const px = cx + dx + hash2D( nx, ny, seed + 17 );
			const py = cy + dy + hash2D( nx, ny, seed + 53 );
			const d = Math.hypot( px - x, py - y );
			if ( d < minD ) minD = d;

		}

	}
	return minD;

}
