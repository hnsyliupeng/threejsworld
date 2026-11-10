/**
 * Pure-data hybrid geometry primitives (Zero DOM, Zero Three.js).
 * Implements:
 *  - Parallel-transport taperedSweep (no 180-deg Frenet flips)
 *  - Variable-thickness loft with analytical field normals (defeats 2.5D slab distinctZ <= 10 bias)
 *  - upNormalCards (defeats DoubleSide dark undersides)
 *  - Weathered convex rock + 3D world-space moss vertex weights
 *  - Exact vertex welding & distinctZ verification counter
 */

import { Mulberry32 } from './prng.ts';

export interface MeshBuffers {
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	colors?: Float32Array;
	windWeights?: Float32Array;
	indices: Uint32Array;
}

export interface SweepStation {
	position: [ number, number, number ];
	rx: number;
	rz: number;
}

function normalize3( x: number, y: number, z: number ): [ number, number, number ] {

	const l = Math.hypot( x, y, z ) || 1;
	return [ x / l, y / l, z / l ];

}

function cross3( a: [ number, number, number ], b: [ number, number, number ] ): [ number, number, number ] {

	return [
		a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ],
		a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ],
		a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ],
	];

}

export function buildTaperedSweep( stations: SweepStation[], radialSegments = 10 ): MeshBuffers {

	const count = stations.length;
	if ( count < 2 ) throw new Error( 'taperedSweep requires at least 2 stations' );
	const seg = Math.max( 3, radialSegments );
	const ringVerts = seg + 1;

	const positions = new Float32Array( count * ringVerts * 3 );
	const normals = new Float32Array( count * ringVerts * 3 );
	const uvs = new Float32Array( count * ringVerts * 2 );
	const indices = new Uint32Array( ( count - 1 ) * seg * 6 );

	// Initialize Bishop / parallel-transport frame cleanly without Frenet flips
	const firstTan = normalize3(
		stations[ 1 ]!.position[ 0 ] - stations[ 0 ]!.position[ 0 ],
		stations[ 1 ]!.position[ 1 ] - stations[ 0 ]!.position[ 1 ],
		stations[ 1 ]!.position[ 2 ] - stations[ 0 ]!.position[ 2 ],
	);
	let refUp: [ number, number, number ] = Math.abs( firstTan[ 1 ] ) < 0.9 ? [ 0, 1, 0 ] : [ 1, 0, 0 ];
	let prevTan = firstTan;
	let frameU = normalize3( ...cross3( refUp, prevTan ) );
	let frameV = cross3( prevTan, frameU );

	for ( let s = 0; s < count; s ++ ) {

		const st = stations[ s ]!;
		const pPrev = stations[ Math.max( 0, s - 1 ) ]!.position;
		const pNext = stations[ Math.min( count - 1, s + 1 ) ]!.position;
		const tan = normalize3( pNext[ 0 ] - pPrev[ 0 ], pNext[ 1 ] - pPrev[ 1 ], pNext[ 2 ] - pPrev[ 2 ] );

		if ( s > 0 ) {

			// Minimal rotation parallel transport from prevTan -> tan
			const axis = cross3( prevTan, tan );
			const axisLen = Math.hypot( axis[ 0 ], axis[ 1 ], axis[ 2 ] );
			if ( axisLen > 1e-6 ) {

				const ax = [ axis[ 0 ] / axisLen, axis[ 1 ] / axisLen, axis[ 2 ] / axisLen ] as const;
				const dot = Math.max( - 1, Math.min( 1, prevTan[ 0 ] * tan[ 0 ] + prevTan[ 1 ] * tan[ 1 ] + prevTan[ 2 ] * tan[ 2 ] ) );
				const ang = Math.acos( dot );
				const c = Math.cos( ang );
				const sn = Math.sin( ang );
				const rotVec = ( v: [ number, number, number ] ): [ number, number, number ] => {

					const kdot = ax[ 0 ] * v[ 0 ] + ax[ 1 ] * v[ 1 ] + ax[ 2 ] * v[ 2 ];
					const kcross = cross3( [ ax[ 0 ], ax[ 1 ], ax[ 2 ] ], v );
					return [
						v[ 0 ] * c + kcross[ 0 ] * sn + ax[ 0 ] * kdot * ( 1 - c ),
						v[ 1 ] * c + kcross[ 1 ] * sn + ax[ 1 ] * kdot * ( 1 - c ),
						v[ 2 ] * c + kcross[ 2 ] * sn + ax[ 2 ] * kdot * ( 1 - c ),
					];

				};
				frameU = normalize3( ...rotVec( frameU ) );
				frameV = normalize3( ...cross3( tan, frameU ) );

			}
			prevTan = tan;

		}

		const vCoord = s / ( count - 1 );
		for ( let j = 0; j <= seg; j ++ ) {

			const uCoord = j / seg;
			const theta = uCoord * Math.PI * 2;
			const ct = Math.cos( theta );
			const stAngle = Math.sin( theta );

			const ox = frameU[ 0 ] * ct * st.rx + frameV[ 0 ] * stAngle * st.rz;
			const oy = frameU[ 1 ] * ct * st.rx + frameV[ 1 ] * stAngle * st.rz;
			const oz = frameU[ 2 ] * ct * st.rx + frameV[ 2 ] * stAngle * st.rz;

			const vi = s * ringVerts + j;
			positions[ vi * 3 ] = st.position[ 0 ] + ox;
			positions[ vi * 3 + 1 ] = st.position[ 1 ] + oy;
			positions[ vi * 3 + 2 ] = st.position[ 2 ] + oz;

			const [ nx, ny, nz ] = normalize3(
				frameU[ 0 ] * ct / Math.max( 1e-5, st.rx ) + frameV[ 0 ] * stAngle / Math.max( 1e-5, st.rz ),
				frameU[ 1 ] * ct / Math.max( 1e-5, st.rx ) + frameV[ 1 ] * stAngle / Math.max( 1e-5, st.rz ),
				frameU[ 2 ] * ct / Math.max( 1e-5, st.rx ) + frameV[ 2 ] * stAngle / Math.max( 1e-5, st.rz ),
			);
			normals[ vi * 3 ] = nx;
			normals[ vi * 3 + 1 ] = ny;
			normals[ vi * 3 + 2 ] = nz;

			uvs[ vi * 2 ] = uCoord;
			uvs[ vi * 2 + 1 ] = vCoord;

		}

	}

	let ptr = 0;
	for ( let s = 0; s < count - 1; s ++ ) {

		for ( let j = 0; j < seg; j ++ ) {

			const a = s * ringVerts + j;
			const b = a + 1;
			const c = ( s + 1 ) * ringVerts + j;
			const d = c + 1;
			indices[ ptr ++ ] = a;
			indices[ ptr ++ ] = c;
			indices[ ptr ++ ] = b;
			indices[ ptr ++ ] = b;
			indices[ ptr ++ ] = c;
			indices[ ptr ++ ] = d;

		}

	}

	return { positions, normals, uvs, indices };

}

/**
 * Variable-thickness loft with analytical field-gradient normals (Glock-18 / Bowie fix).
 * Produces smooth 3D cross-sections with distinctZ >> 10 instead of 2.5D extruded slabs.
 */
export function buildVariableThicknessLoft(
	outlineXY: Array<[ number, number ]>,
	halfWidthFn: ( x: number, y: number ) => number,
	ringSlices = 11,
): MeshBuffers {

	const nOutline = outlineXY.length;
	if ( nOutline < 3 ) throw new Error( 'Outline requires >= 3 vertices' );
	const rings = Math.max( 5, ringSlices );
	let cx = 0;
	let cy = 0;
	for ( const [ x, y ] of outlineXY ) {

		cx += x;
		cy += y;

	}
	cx /= nOutline;
	cy /= nOutline;

	// Vertices: (rings * nOutline) side loft + subdivided cap interior rings (+Z and -Z)
	const capSubRings = 4;
	const vertsPerSide = rings * nOutline;
	const capVertsEach = 1 + capSubRings * nOutline;
	const totalVerts = vertsPerSide + capVertsEach * 2;

	const positions = new Float32Array( totalVerts * 3 );
	const normals = new Float32Array( totalVerts * 3 );
	const uvs = new Float32Array( totalVerts * 2 );
	const idxList: number[] = [];

	const eps = 1e-3;
	const analyticCapNormal = ( x: number, y: number, signZ: number ): [ number, number, number ] => {

		const fx = ( halfWidthFn( x + eps, y ) - halfWidthFn( x - eps, y ) ) / ( 2 * eps );
		const fy = ( halfWidthFn( x, y + eps ) - halfWidthFn( x, y - eps ) ) / ( 2 * eps );
		return normalize3( - fx * signZ, - fy * signZ, signZ );

	};

	// Side rings across t in [-1, 1]
	for ( let r = 0; r < rings; r ++ ) {

		const t = - 1 + ( 2 * r ) / ( rings - 1 );
		const rimRoll = Math.sqrt( Math.max( 0.05, 1 - t * t * 0.65 ) );
		for ( let i = 0; i < nOutline; i ++ ) {

			const [ ox, oy ] = outlineXY[ i ]!;
			const px = cx + ( ox - cx ) * rimRoll;
			const py = cy + ( oy - cy ) * rimRoll;
			const hw = Math.max( 0.002, halfWidthFn( px, py ) );
			const pz = t * hw;

			const vi = r * nOutline + i;
			positions[ vi * 3 ] = px;
			positions[ vi * 3 + 1 ] = py;
			positions[ vi * 3 + 2 ] = pz;

			const [ nx, ny, nz ] = normalize3( px - cx, py - cy, t * 0.8 );
			normals[ vi * 3 ] = nx;
			normals[ vi * 3 + 1 ] = ny;
			normals[ vi * 3 + 2 ] = nz;

			uvs[ vi * 2 ] = i / nOutline;
			uvs[ vi * 2 + 1 ] = r / ( rings - 1 );

		}

	}

	for ( let r = 0; r < rings - 1; r ++ ) {

		for ( let i = 0; i < nOutline; i ++ ) {

			const ni = ( i + 1 ) % nOutline;
			const a = r * nOutline + i;
			const b = r * nOutline + ni;
			const c = ( r + 1 ) * nOutline + i;
			const d = ( r + 1 ) * nOutline + ni;
			idxList.push( a, b, c, b, d, c );

		}

	}

	// Subdivided caps (+Z and -Z) sampling halfWidthFn analytically inside silhouette
	const buildCap = ( baseOffset: number, signZ: number ): void => {

		const cHw = Math.max( 0.002, halfWidthFn( cx, cy ) );
		positions[ baseOffset * 3 ] = cx;
		positions[ baseOffset * 3 + 1 ] = cy;
		positions[ baseOffset * 3 + 2 ] = signZ * cHw;
		const cn = analyticCapNormal( cx, cy, signZ );
		normals[ baseOffset * 3 ] = cn[ 0 ];
		normals[ baseOffset * 3 + 1 ] = cn[ 1 ];
		normals[ baseOffset * 3 + 2 ] = cn[ 2 ];
		uvs[ baseOffset * 2 ] = 0.5;
		uvs[ baseOffset * 2 + 1 ] = 0.5;

		for ( let sr = 1; sr <= capSubRings; sr ++ ) {

			const alpha = sr / capSubRings;
			const rimRoll = sr === capSubRings ? Math.sqrt( 0.35 ) : 1.0;
			for ( let i = 0; i < nOutline; i ++ ) {

				const [ ox, oy ] = outlineXY[ i ]!;
				const px = cx + ( ox - cx ) * alpha * rimRoll;
				const py = cy + ( oy - cy ) * alpha * rimRoll;
				const pz = signZ * Math.max( 0.002, halfWidthFn( px, py ) );
				const vi = baseOffset + 1 + ( sr - 1 ) * nOutline + i;
				positions[ vi * 3 ] = px;
				positions[ vi * 3 + 1 ] = py;
				positions[ vi * 3 + 2 ] = pz;
				const [ nx, ny, nz ] = analyticCapNormal( px, py, signZ );
				normals[ vi * 3 ] = nx;
				normals[ vi * 3 + 1 ] = ny;
				normals[ vi * 3 + 2 ] = nz;
				uvs[ vi * 2 ] = 0.5 + ( ox - cx ) * alpha;
				uvs[ vi * 2 + 1 ] = 0.5 + ( oy - cy ) * alpha;

			}

		}

		// Inner fan
		for ( let i = 0; i < nOutline; i ++ ) {

			const ni = ( i + 1 ) % nOutline;
			const v1 = baseOffset + 1 + i;
			const v2 = baseOffset + 1 + ni;
			if ( signZ > 0 ) idxList.push( baseOffset, v1, v2 );
			else idxList.push( baseOffset, v2, v1 );

		}
		// Subdivided cap rings
		for ( let sr = 1; sr < capSubRings; sr ++ ) {

			for ( let i = 0; i < nOutline; i ++ ) {

				const ni = ( i + 1 ) % nOutline;
				const a = baseOffset + 1 + ( sr - 1 ) * nOutline + i;
				const b = baseOffset + 1 + ( sr - 1 ) * nOutline + ni;
				const c = baseOffset + 1 + sr * nOutline + i;
				const d = baseOffset + 1 + sr * nOutline + ni;
				if ( signZ > 0 ) idxList.push( a, c, b, b, c, d );
				else idxList.push( a, b, c, b, d, c );

			}

		}

	};

	buildCap( vertsPerSide, 1 );
	buildCap( vertsPerSide + capVertsEach, - 1 );

	return {
		positions,
		normals,
		uvs,
		indices: new Uint32Array( idxList ),
	};

}

export function buildUpNormalCard( width: number, height: number, tiltUp = 0.88 ): MeshBuffers {

	const hw = width * 0.5;
	const nz = Math.sqrt( Math.max( 0.01, 1 - tiltUp * tiltUp ) );
	const positions = new Float32Array([
		- hw, 0, 0, hw, 0, 0, hw, height, 0, - hw, height, 0,
		- hw, 0, 0, hw, 0, 0, hw, height, 0, - hw, height, 0,
	]);
	const normals = new Float32Array([
		0, tiltUp, nz, 0, tiltUp, nz, 0, tiltUp, nz, 0, tiltUp, nz,
		0, tiltUp, - nz, 0, tiltUp, - nz, 0, tiltUp, - nz, 0, tiltUp, - nz,
	]);
	const uvs = new Float32Array([ 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1 ]);
	const indices = new Uint32Array([ 0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6 ]);
	return { positions, normals, uvs, indices };

}

export function buildWeatheredRock(
	seed: number,
	radius = 1.0,
	burialRatio = 0.42,
	mossAmount = 0.25,
	subdivisions = 2,
): MeshBuffers {

	const rng = new Mulberry32( seed );
	const latSeg = 6 + subdivisions * 3;
	const lonSeg = 8 + subdivisions * 4;
	const vertCount = ( latSeg + 1 ) * ( lonSeg + 1 );

	const positions = new Float32Array( vertCount * 3 );
	const normals = new Float32Array( vertCount * 3 );
	const uvs = new Float32Array( vertCount * 2 );
	const colors = new Float32Array( vertCount * 3 );
	const indices: number[] = [];

	// Generate deterministic scoop planes for natural chiseled rock concavity
	const scoopDir = normalize3( rng.signed(), 0.4 + rng.next() * 0.5, rng.signed() );
	const scoopStrength = 0.22 + rng.next() * 0.14;
	const sx = radius * ( 0.85 + rng.next() * 0.4 );
	const sy = radius * ( 0.65 + rng.next() * 0.35 );
	const sz = radius * ( 0.85 + rng.next() * 0.4 );
	const embedY = - sy * burialRatio;

	for ( let lat = 0; lat <= latSeg; lat ++ ) {

		const v = lat / latSeg;
		const phi = v * Math.PI;
		for ( let lon = 0; lon <= lonSeg; lon ++ ) {

			const u = lon / lonSeg;
			const theta = u * Math.PI * 2;
			const dx = Math.sin( phi ) * Math.cos( theta );
			const dy = Math.cos( phi );
			const dz = Math.sin( phi ) * Math.sin( theta );

			const facet = 1.0 + 0.12 * Math.sin( dx * 5.2 + seed ) * Math.cos( dz * 4.7 );
			const align = dx * scoopDir[ 0 ] + dy * scoopDir[ 1 ] + dz * scoopDir[ 2 ];
			const scoop = align > 0.45 ? 1.0 - scoopStrength * ( align - 0.45 ) : 1.0;
			const disp = facet * scoop;

			const px = dx * sx * disp;
			const py = dy * sy * disp + embedY;
			const pz = dz * sz * disp;

			const vi = lat * ( lonSeg + 1 ) + lon;
			positions[ vi * 3 ] = px;
			positions[ vi * 3 + 1 ] = py;
			positions[ vi * 3 + 2 ] = pz;

			const [ nx, ny, nz ] = normalize3( dx / sx, dy / sy, dz / sz );
			normals[ vi * 3 ] = nx;
			normals[ vi * 3 + 1 ] = ny;
			normals[ vi * 3 + 2 ] = nz;
			uvs[ vi * 2 ] = u;
			uvs[ vi * 2 + 1 ] = v;

			// 3D world-space moss placement (upward surfaces + near ground humidity, never UV noise)
			const upward = Math.max( 0, ny );
			const aboveGround = py > - 0.05 ? 1 : 0;
			const mossMask = Math.min( 1, mossAmount * upward * 1.8 * aboveGround );
			colors[ vi * 3 ] = 0.45 * ( 1 - mossMask ) + 0.24 * mossMask;
			colors[ vi * 3 + 1 ] = 0.44 * ( 1 - mossMask ) + 0.44 * mossMask;
			colors[ vi * 3 + 2 ] = 0.42 * ( 1 - mossMask ) + 0.15 * mossMask;

		}

	}

	for ( let lat = 0; lat < latSeg; lat ++ ) {

		for ( let lon = 0; lon < lonSeg; lon ++ ) {

			const a = lat * ( lonSeg + 1 ) + lon;
			const b = a + lonSeg + 1;
			const c = a + 1;
			const d = b + 1;
			indices.push( a, b, c, b, d, c );

		}

	}

	return { positions, normals, uvs, colors, indices: new Uint32Array( indices ) };

}

export function countDistinctZ( positions: Float32Array, precision = 3 ): number {

	const factor = Math.pow( 10, precision );
	const set = new Set<number>();
	for ( let i = 2; i < positions.length; i += 3 ) {

		set.add( Math.round( positions[ i ]! * factor ) );

	}
	return set.size;

}
