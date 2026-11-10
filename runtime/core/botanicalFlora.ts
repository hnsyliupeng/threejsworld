/**
 * Pure-data Procedural Trees (multi-level recursive ez-tree + solstice grammar),
 * Sculpted 3D Flowers (Daisy, Wild Rose, Garden Tulip), and V-Creased Grass + Seed Heads.
 * Zero DOM / Zero Three.js dependencies.
 */

import { Mulberry32 } from './prng.ts';
import type { MeshBuffers } from './geometryPrimitives.ts';

const GOLDEN_ANGLE = 2.399963229728653;

export type TreePresetId = 'oak' | 'pine' | 'birch';
export type FlowerPresetId = 'daisy' | 'rose' | 'tulip';
export type GrassPresetId = 'fescue' | 'foxtail' | 'sedge';

export interface TreeGenConfig {
	preset: TreePresetId;
	seed: number;
	heightScale?: number;
}

export interface RealisticTreeBuffers {
	bark: MeshBuffers;
	leaves: MeshBuffers;
	leafCount: number;
	branchCount: number;
}

function norm3( x: number, y: number, z: number, fallback: [ number, number, number ] = [ 0, 1, 0 ] ): [ number, number, number ] {

	const l = Math.hypot( x, y, z );
	if ( l < 1e-6 ) return fallback;
	return [ x / l, y / l, z / l ];

}

function cross3( a: [ number, number, number ], b: [ number, number, number ] ): [ number, number, number ] {

	return [
		a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ],
		a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ],
		a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ],
	];

}

function rotAxis( v: [ number, number, number ], axis: [ number, number, number ], angle: number ): [ number, number, number ] {

	const c = Math.cos( angle );
	const s = Math.sin( angle );
	const d = axis[ 0 ] * v[ 0 ] + axis[ 1 ] * v[ 1 ] + axis[ 2 ] * v[ 2 ];
	const cr = cross3( axis, v );
	return [
		v[ 0 ] * c + cr[ 0 ] * s + axis[ 0 ] * d * ( 1 - c ),
		v[ 1 ] * c + cr[ 1 ] * s + axis[ 1 ] * d * ( 1 - c ),
		v[ 2 ] * c + cr[ 2 ] * s + axis[ 2 ] * d * ( 1 - c ),
	];

}

interface BranchSpec {
	levels: number;
	trunkHeight: number;
	trunkRadius: number;
	buttressFlare: number;
	children: [ number, number, number ];
	lengthScale: [ number, number, number ];
	radiusScale: [ number, number, number ];
	angleDeg: [ number, number, number ];
	gnarliness: [ number, number, number, number ];
	taper: [ number, number, number, number ];
	forceUp: [ number, number, number, number ];
	startRange: [ number, number ];
	leavesPerTwig: number;
	leafSize: number;
	isConifer: boolean;
}

const TREE_SPECS: Record<TreePresetId, BranchSpec> = {
	oak: {
		levels: 3,
		trunkHeight: 3.1,
		trunkRadius: 0.34,
		buttressFlare: 0.45,
		children: [ 6, 4, 3 ],
		lengthScale: [ 0.78, 0.70, 0.62 ],
		radiusScale: [ 0.56, 0.52, 0.48 ],
		angleDeg: [ 46, 48, 52 ],
		gnarliness: [ 0.14, 0.24, 0.32, 0.36 ],
		taper: [ 0.86, 0.78, 0.82, 0.88 ],
		forceUp: [ 0.04, 0.12, 0.18, 0.10 ],
		startRange: [ 0.40, 0.96 ],
		leavesPerTwig: 6,
		leafSize: 0.88,
		isConifer: false,
	},
	pine: {
		levels: 3,
		trunkHeight: 6.8,
		trunkRadius: 0.22,
		buttressFlare: 0.34,
		children: [ 22, 3, 2 ],
		lengthScale: [ 0.33, 0.58, 0.52 ],
		radiusScale: [ 0.38, 0.55, 0.50 ],
		angleDeg: [ 80, 32, 28 ],
		gnarliness: [ 0.04, 0.08, 0.14, 0.18 ],
		taper: [ 0.86, 0.74, 0.80, 0.85 ],
		forceUp: [ 0.02, 0.02, 0.06, 0.10 ],
		startRange: [ 0.30, 0.98 ],
		leavesPerTwig: 5,
		leafSize: 0.74,
		isConifer: true,
	},
	birch: {
		levels: 3,
		trunkHeight: 4.8,
		trunkRadius: 0.16,
		buttressFlare: 0.26,
		children: [ 9, 4, 2 ],
		lengthScale: [ 0.48, 0.66, 0.60 ],
		radiusScale: [ 0.46, 0.54, 0.50 ],
		angleDeg: [ 36, 42, 48 ],
		gnarliness: [ 0.11, 0.18, 0.25, 0.30 ],
		taper: [ 0.76, 0.76, 0.82, 0.88 ],
		forceUp: [ 0.05, 0.04, - 0.10, - 0.20 ],
		startRange: [ 0.34, 0.97 ],
		leavesPerTwig: 5,
		leafSize: 0.68,
		isConifer: false,
	},
};

export function generateRealisticTree( config: TreeGenConfig ): RealisticTreeBuffers {

	const spec = TREE_SPECS[ config.preset ];
	const rng = new Mulberry32( config.seed );
	const hScale = config.heightScale ?? 1.0;

	const bPos: number[] = [];
	const bNrm: number[] = [];
	const bUv: number[] = [];
	const bCol: number[] = [];
	const bIdx: number[] = [];

	const lPos: number[] = [];
	const lNrm: number[] = [];
	const lUv: number[] = [];
	const lCol: number[] = [];
	const lWind: number[] = [];
	const lIdx: number[] = [];

	let branchCount = 0;
	let leafCount = 0;
	const crownCenterY = spec.trunkHeight * hScale * 0.95;

	const appendLeafSpray = (
		origin: [ number, number, number ],
		dir: [ number, number, number ],
		size: number,
		count: number,
	): void => {

		for ( let k = 0; k < count; k ++ ) {

			const az = k * GOLDEN_ANGLE + rng.next() * 1.2;
			const spread = size * ( k === 0 ? 0.04 : rng.range( 0.20, 0.52 ) );
			const ox = origin[ 0 ] + Math.cos( az ) * spread + dir[ 0 ] * size * 0.12;
			const oy = origin[ 1 ] + ( spec.isConifer ? rng.range( - 0.10, 0.14 ) : rng.range( - 0.18, 0.28 ) ) * size;
			const oz = origin[ 2 ] + Math.sin( az ) * spread + dir[ 2 ] * size * 0.12;

			const cardSize = size * rng.range( 0.80, 1.15 );
			const hw = cardSize * 0.5;
			const hh = cardSize * 0.5;

			// UpNormal crown-outward vector (eliminates dark undersides while staying FrontSide)
			const upOut = norm3(
				ox * 0.42 + rng.signed() * 0.22,
				Math.max( 0.55, oy - crownCenterY * 0.42 + 0.85 ),
				oz * 0.42 + rng.signed() * 0.22,
			);

			// Natural volumetric foliage palette variation (brighter sunlit top, richer interior)
			const topShade = 0.84 + 0.26 * Math.min( 1, Math.max( 0, ( oy - crownCenterY * 0.4 ) / ( crownCenterY * 0.8 ) ) );
			const hueVar = rng.range( - 0.06, 0.07 );
			const cr = Math.min( 1, Math.max( 0.45, topShade + hueVar ) );
			const cg = Math.min( 1, Math.max( 0.50, topShade ) );
			const cb = Math.min( 1, Math.max( 0.40, topShade - 0.05 ) );
			const windW = Math.min( 1, Math.max( 0.1, oy / ( spec.trunkHeight * hScale * 1.4 ) ) );

			// 2 intersecting oblique 3D planes (tilted across canopy & horizontal branch planes — never hanging curtains!)
			for ( let plane = 0; plane < 2; plane ++ ) {

				const yaw = az + plane * 1.15;
				// Conifer needles form horizontal pad boughs; deciduous crowns spread across full 3D sphere angles
				const pitch = spec.isConifer
					? ( plane === 0 ? rng.range( 1.05, 1.38 ) : rng.range( 0.65, 1.05 ) )
					: ( plane === 0 ? rng.range( 0.55, 1.25 ) : rng.range( - 1.15, - 0.45 ) );
				const roll = rng.range( - 0.65, 0.65 );

				const uBase: [ number, number, number ] = [ Math.cos( yaw ), 0, - Math.sin( yaw ) ];
				const vRaw: [ number, number, number ] = [ Math.sin( yaw ) * Math.sin( pitch ), Math.cos( pitch ), Math.cos( yaw ) * Math.sin( pitch ) ];
				const axisFwd = norm3( ...cross3( uBase, vRaw ) );
				const uAxis = norm3( ...rotAxis( uBase, axisFwd, roll ) );
				const vAxis = norm3( ...rotAxis( vRaw, axisFwd, roll ) );

				const quad: Array<[ number, number, number, number ]> = [
					[ - hw, - hh, 0, 0 ],
					[ hw, - hh, 1, 0 ],
					[ hw, hh, 1, 1 ],
					[ - hw, hh, 0, 1 ],
				];

				const baseV = lPos.length / 3;
				for ( let side = 0; side < 2; side ++ ) {

					for ( const [ lx, ly, u, v ] of quad ) {

						lPos.push(
							ox + uAxis[ 0 ] * lx + vAxis[ 0 ] * ly,
							oy + uAxis[ 1 ] * lx + vAxis[ 1 ] * ly,
							oz + uAxis[ 2 ] * lx + vAxis[ 2 ] * ly,
						);
						lNrm.push( upOut[ 0 ], upOut[ 1 ], upOut[ 2 ] );
						lUv.push( u, v );
						lCol.push( cr, cg, cb );
						lWind.push( windW );

					}

				}
				lIdx.push(
					baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3,
					baseV + 4, baseV + 6, baseV + 5, baseV + 4, baseV + 7, baseV + 6,
				);
				leafCount ++;

			}

		}

	};

	const growBranch = (
		origin: [ number, number, number ],
		startDir: [ number, number, number ],
		length: number,
		radius: number,
		level: number,
	): void => {

		branchCount ++;
		const segs = level === 0 ? 11 : level === 1 ? 7 : 5;
		const radialSegs = level === 0 ? 10 : level === 1 ? 7 : 5;
		const gnarl = spec.gnarliness[ level ]!;
		const taper = spec.taper[ level ]!;
		const forceUp = spec.forceUp[ level ]!;

		const pts: Array<[ number, number, number ]> = [];
		const dirs: Array<[ number, number, number ]> = [];
		const rads: number[] = [];

		let cur = [ origin[ 0 ], origin[ 1 ], origin[ 2 ] ] as [ number, number, number ];
		let dir = norm3( startDir[ 0 ], startDir[ 1 ], startDir[ 2 ] );
		const stepLen = length / segs;

		for ( let s = 0; s <= segs; s ++ ) {

			const t = s / segs;
			pts.push( [ cur[ 0 ], cur[ 1 ], cur[ 2 ] ] );
			dirs.push( [ dir[ 0 ], dir[ 1 ], dir[ 2 ] ] );

			const flare = level === 0 && t < 0.22
				? 1.0 + spec.buttressFlare * Math.pow( 1.0 - t / 0.22, 1.7 )
				: 1.0;
			rads.push( Math.max( 0.007, radius * flare * ( 1.0 - taper * t ) ) );

			if ( s < segs ) {

				const jitterX = rng.signed() * gnarl;
				const jitterY = rng.signed() * gnarl * 0.5 + forceUp;
				const jitterZ = rng.signed() * gnarl;
				dir = norm3( dir[ 0 ] + jitterX, dir[ 1 ] + jitterY, dir[ 2 ] + jitterZ );
				cur = [
					cur[ 0 ] + dir[ 0 ] * stepLen,
					cur[ 1 ] + dir[ 1 ] * stepLen,
					cur[ 2 ] + dir[ 2 ] * stepLen,
				];

			}

		}

		// Parallel transport tube extrusion (zero Frenet 180-deg twists)
		let frameU = norm3( ...cross3( Math.abs( dirs[ 0 ]![ 1 ] ) < 0.9 ? [ 0, 1, 0 ] : [ 1, 0, 0 ], dirs[ 0 ]! ) );
		let frameV = cross3( dirs[ 0 ]!, frameU );
		const baseVert = bPos.length / 3;
		const stride = radialSegs + 1;

		for ( let s = 0; s <= segs; s ++ ) {

			const t = s / segs;
			if ( s > 0 ) {

				const prevD = dirs[ s - 1 ]!;
				const curD = dirs[ s ]!;
				const axis = cross3( prevD, curD );
				const axLen = Math.hypot( axis[ 0 ], axis[ 1 ], axis[ 2 ] );
				if ( axLen > 1e-6 ) {

					const dot = Math.max( - 1, Math.min( 1, prevD[ 0 ] * curD[ 0 ] + prevD[ 1 ] * curD[ 1 ] + prevD[ 2 ] * curD[ 2 ] ) );
					frameU = norm3( ...rotAxis( frameU, [ axis[ 0 ] / axLen, axis[ 1 ] / axLen, axis[ 2 ] / axLen ], Math.acos( dot ) ) );
					frameV = norm3( ...cross3( curD, frameU ) );

				}

			}

			// Clean bark brightness down into soil collar (no artificial black shadow band at ground intersect)
			const aoBase = level === 0 ? ( 0.88 + 0.12 * Math.min( 1, t * 4.0 ) ) : 0.95;
			for ( let j = 0; j <= radialSegs; j ++ ) {

				const u = j / radialSegs;
				const th = u * Math.PI * 2;
				const ct = Math.cos( th );
				const st = Math.sin( th );
				const flute = level === 0 && t < 0.22
					? 1.0 + 0.18 * ( 1.0 - t / 0.22 ) * Math.cos( th * 5.0 + 0.6 )
					: 1.0;
				const r = rads[ s ]! * flute;

				const nx = frameU[ 0 ] * ct + frameV[ 0 ] * st;
				const ny = frameU[ 1 ] * ct + frameV[ 1 ] * st;
				const nz = frameU[ 2 ] * ct + frameV[ 2 ] * st;

				bPos.push( pts[ s ]![ 0 ] + nx * r, pts[ s ]![ 1 ] + ny * r, pts[ s ]![ 2 ] + nz * r );
				bNrm.push( nx, ny, nz );
				bUv.push( u * ( level === 0 ? 2.0 : 1.0 ), t * length * 1.4 );
				bCol.push( aoBase, aoBase, aoBase );

			}

		}

		for ( let s = 0; s < segs; s ++ ) {

			for ( let j = 0; j < radialSegs; j ++ ) {

				const a = baseVert + s * stride + j;
				const b = a + 1;
				const c = a + stride;
				const d = c + 1;
				// Outward-facing CCW winding: cross(theta_dir, branch_axis) points outward (+frameU/+frameV)
				bIdx.push( a, b, c, b, d, c );

			}

		}

		// Watertight rounded tip cap so even --without leaves ablation has zero open tube holes
		const tipPt = pts[ segs ]!;
		const tipDir = dirs[ segs ]!;
		const tipRad = rads[ segs ]!;
		if ( tipRad > 0.002 ) {

			const apexIdx = bPos.length / 3;
			bPos.push(
				tipPt[ 0 ] + tipDir[ 0 ] * tipRad * 0.45,
				tipPt[ 1 ] + tipDir[ 1 ] * tipRad * 0.45,
				tipPt[ 2 ] + tipDir[ 2 ] * tipRad * 0.45,
			);
			bNrm.push( tipDir[ 0 ], tipDir[ 1 ], tipDir[ 2 ] );
			bUv.push( 0.5, 1.0 );
			bCol.push( 0.96, 0.96, 0.96 );
			const ringStart = baseVert + segs * stride;
			for ( let j = 0; j < radialSegs; j ++ ) {

				const a = ringStart + j;
				const b = a + 1;
				bIdx.push( a, b, apexIdx );

			}

		}

		if ( level < spec.levels ) {

			const nChildren = spec.children[ level ]!;
			const startFrac = level === 0 ? spec.startRange[ 0 ] : 0.28;
			const endFrac = level === 0 ? spec.startRange[ 1 ] : 0.96;
			const spreadDeg = spec.angleDeg[ level ]!;

			for ( let c = 0; c < nChildren; c ++ ) {

				const u = nChildren > 1 ? c / ( nChildren - 1 ) : 0.7;
				const along = startFrac + ( endFrac - startFrac ) * u;
				const idxF = along * segs;
				const i0 = Math.min( segs - 1, Math.floor( idxF ) );
				const frac = idxF - i0;

				const cPos: [ number, number, number ] = [
					pts[ i0 ]![ 0 ] + ( pts[ i0 + 1 ]![ 0 ] - pts[ i0 ]![ 0 ] ) * frac,
					pts[ i0 ]![ 1 ] + ( pts[ i0 + 1 ]![ 1 ] - pts[ i0 ]![ 1 ] ) * frac,
					pts[ i0 ]![ 2 ] + ( pts[ i0 + 1 ]![ 2 ] - pts[ i0 ]![ 2 ] ) * frac,
				];
				const pDir = norm3(
					dirs[ i0 ]![ 0 ] + ( dirs[ i0 + 1 ]![ 0 ] - dirs[ i0 ]![ 0 ] ) * frac,
					dirs[ i0 ]![ 1 ] + ( dirs[ i0 + 1 ]![ 1 ] - dirs[ i0 ]![ 1 ] ) * frac,
					dirs[ i0 ]![ 2 ] + ( dirs[ i0 + 1 ]![ 2 ] - dirs[ i0 ]![ 2 ] ) * frac,
				);

				const pU = norm3( ...cross3( Math.abs( pDir[ 1 ] ) < 0.9 ? [ 0, 1, 0 ] : [ 1, 0, 0 ], pDir ) );
				const pV = cross3( pDir, pU );
				const az = c * GOLDEN_ANGLE + level * 1.1 + rng.signed() * 0.25;
				const radVec = norm3(
					pU[ 0 ] * Math.cos( az ) + pV[ 0 ] * Math.sin( az ),
					pU[ 1 ] * Math.cos( az ) + pV[ 1 ] * Math.sin( az ),
					pU[ 2 ] * Math.cos( az ) + pV[ 2 ] * Math.sin( az ),
				);
				const elevRad = ( spreadDeg * rng.range( 0.85, 1.15 ) * Math.PI ) / 180;
				const cDir = norm3(
					pDir[ 0 ] * Math.cos( elevRad ) + radVec[ 0 ] * Math.sin( elevRad ),
					pDir[ 1 ] * Math.cos( elevRad ) + radVec[ 1 ] * Math.sin( elevRad ),
					pDir[ 2 ] * Math.cos( elevRad ) + radVec[ 2 ] * Math.sin( elevRad ),
				);

				const coneScale = spec.isConifer && level === 0 ? Math.max( 0.22, 1.12 - u * 0.88 ) : ( 1.0 - 0.22 * u );
				const cLen = length * spec.lengthScale[ level ]! * coneScale * rng.range( 0.86, 1.14 );
				const cRad = rads[ i0 ]! * spec.radiusScale[ level ]!;

				growBranch( cPos, cDir, cLen, cRad, level + 1 );

			}

		}

		// Attach dense foliage sprays along outer branches and twigs
		if ( level >= spec.levels - 1 ) {

			appendLeafSpray( pts[ pts.length - 1 ]!, dirs[ dirs.length - 1 ]!, spec.leafSize * hScale, spec.leavesPerTwig );
			if ( level === spec.levels ) {

				appendLeafSpray( pts[ Math.floor( segs * 0.55 ) ]!, dirs[ Math.floor( segs * 0.55 ) ]!, spec.leafSize * 0.85 * hScale, 2 );

			}

		}

	};

	const embedY = - 0.22 * hScale;
	growBranch( [ 0, embedY, 0 ], [ 0, 1, 0 ], spec.trunkHeight * hScale - embedY, spec.trunkRadius * hScale, 0 );

	return {
		bark: {
			positions: new Float32Array( bPos ),
			normals: new Float32Array( bNrm ),
			uvs: new Float32Array( bUv ),
			colors: new Float32Array( bCol ),
			indices: new Uint32Array( bIdx ),
		},
		leaves: {
			positions: new Float32Array( lPos ),
			normals: new Float32Array( lNrm ),
			uvs: new Float32Array( lUv ),
			colors: new Float32Array( lCol ),
			windWeights: new Float32Array( lWind ),
			indices: new Uint32Array( lIdx ),
		},
		leafCount,
		branchCount,
	};

}

export interface FlowerBuffers {
	stemsAndLeaves: MeshBuffers;
	petals: MeshBuffers;
	centerDisc: MeshBuffers;
}

function appendCurvedRibbon(
	pos: number[],
	nrm: number[],
	uv: number[],
	col: number[],
	wind: number[],
	idx: number[],
	uSegs: number,
	vSegs: number,
	evalFn: ( u: number, v: number ) => {
		p: [ number, number, number ];
		c: [ number, number, number ];
		w: number;
	},
	defaultNormal: [ number, number, number ] = [ 0, 1, 0 ],
): void {

	const baseV = pos.length / 3;
	const grid: Array<[ number, number, number ]> = [];
	const cols: Array<[ number, number, number ]> = [];
	const ws: number[] = [];

	for ( let iv = 0; iv <= vSegs; iv ++ ) {

		const v = iv / vSegs;
		for ( let iu = 0; iu <= uSegs; iu ++ ) {

			const u = iu / uSegs;
			const r = evalFn( u, v );
			grid.push( r.p );
			cols.push( r.c );
			ws.push( r.w );

		}

	}

	const stride = uSegs + 1;
	// First compute row-by-row finite difference tangents, keeping safe fallback when width pinches at apex/claw
	const rowFallbackNormals: Array<[ number, number, number ]> = [];
	for ( let iv = 0; iv <= vSegs; iv ++ ) {

		const midU = Math.floor( uSegs / 2 );
		const pL = grid[ iv * stride + Math.max( 0, midU - 1 ) ]!;
		const pR = grid[ iv * stride + Math.min( uSegs, midU + 1 ) ]!;
		const pD = grid[ Math.max( 0, iv - 1 ) * stride + midU ]!;
		const pU = grid[ Math.min( vSegs, iv + 1 ) * stride + midU ]!;
		const tU: [ number, number, number ] = [ pR[ 0 ] - pL[ 0 ], pR[ 1 ] - pL[ 1 ], pR[ 2 ] - pL[ 2 ] ];
		const tV: [ number, number, number ] = [ pU[ 0 ] - pD[ 0 ], pU[ 1 ] - pD[ 1 ], pU[ 2 ] - pD[ 2 ] ];
		const cr = cross3( tU, tV );
		rowFallbackNormals.push( Math.hypot( cr[ 0 ], cr[ 1 ], cr[ 2 ] ) > 1e-6 ? norm3( ...cr ) : defaultNormal );

	}
	// Propagate valid middle-row normal into pinched boundary rows v=0 and v=vSegs
	for ( let iv = 0; iv <= vSegs; iv ++ ) {

		if ( rowFallbackNormals[ iv ] === defaultNormal ) {

			const neighbor = iv === 0 ? Math.min( vSegs, 1 ) : Math.max( 0, iv - 1 );
			rowFallbackNormals[ iv ] = rowFallbackNormals[ neighbor ]!;

		}

	}

	for ( let iv = 0; iv <= vSegs; iv ++ ) {

		const v = iv / vSegs;
		const rowFb = rowFallbackNormals[ iv ]!;
		for ( let iu = 0; iu <= uSegs; iu ++ ) {

			const u = iu / uSegs;
			const p = grid[ iv * stride + iu ]!;
			const pL = grid[ iv * stride + Math.max( 0, iu - 1 ) ]!;
			const pR = grid[ iv * stride + Math.min( uSegs, iu + 1 ) ]!;
			const pD = grid[ Math.max( 0, iv - 1 ) * stride + iu ]!;
			const pU = grid[ Math.min( vSegs, iv + 1 ) * stride + iu ]!;

			const tU: [ number, number, number ] = [ pR[ 0 ] - pL[ 0 ], pR[ 1 ] - pL[ 1 ], pR[ 2 ] - pL[ 2 ] ];
			const tV: [ number, number, number ] = [ pU[ 0 ] - pD[ 0 ], pU[ 1 ] - pD[ 1 ], pU[ 2 ] - pD[ 2 ] ];
			const cr = cross3( tU, tV );
			// Never return [0, 0, 0] normal (which renders black rings on pinched petal/sepal ends!)
			const n = Math.hypot( cr[ 0 ], cr[ 1 ], cr[ 2 ] ) > 1e-7
				? norm3( cr[ 0 ], cr[ 1 ], cr[ 2 ], rowFb )
				: rowFb;
			const c = cols[ iv * stride + iu ]!;

			pos.push( p[ 0 ], p[ 1 ], p[ 2 ] );
			nrm.push( n[ 0 ], n[ 1 ], n[ 2 ] );
			uv.push( u, v );
			col.push( c[ 0 ], c[ 1 ], c[ 2 ] );
			wind.push( ws[ iv * stride + iu ]! );

		}

	}

	for ( let iv = 0; iv < vSegs; iv ++ ) {

		for ( let iu = 0; iu < uSegs; iu ++ ) {

			const a = baseV + iv * stride + iu;
			const b = a + 1;
			const c = a + stride;
			const d = c + 1;
			idx.push( a, b, c, b, d, c );

		}

	}

}

function appendTaperedTube(
	pos: number[],
	nrm: number[],
	uv: number[],
	col: number[],
	wind: number[],
	idx: number[],
	pts: Array<[ number, number, number ]>,
	rads: number[],
	colors: Array<[ number, number, number ]>,
	radialSegs = 6,
	maxHeight = 0.5,
): void {

	const baseV = pos.length / 3;
	const stride = radialSegs + 1;
	for ( let i = 0; i < pts.length; i ++ ) {

		const p = pts[ i ]!;
		const pPrev = pts[ Math.max( 0, i - 1 ) ]!;
		const pNext = pts[ Math.min( pts.length - 1, i + 1 ) ]!;
		const tan = norm3( pNext[ 0 ] - pPrev[ 0 ], pNext[ 1 ] - pPrev[ 1 ], pNext[ 2 ] - pPrev[ 2 ] );
		const fU = norm3( ...cross3( Math.abs( tan[ 1 ] ) < 0.9 ? [ 0, 1, 0 ] : [ 1, 0, 0 ], tan ) );
		const fV = cross3( tan, fU );
		const r = rads[ i ]!;
		const c = colors[ i ]!;
		const w = Math.max( 0, Math.min( 1, p[ 1 ] / Math.max( 0.05, maxHeight ) ) );

		for ( let j = 0; j <= radialSegs; j ++ ) {

			const th = ( j / radialSegs ) * Math.PI * 2;
			const nx = fU[ 0 ] * Math.cos( th ) + fV[ 0 ] * Math.sin( th );
			const ny = fU[ 1 ] * Math.cos( th ) + fV[ 1 ] * Math.sin( th );
			const nz = fU[ 2 ] * Math.cos( th ) + fV[ 2 ] * Math.sin( th );
			pos.push( p[ 0 ] + nx * r, p[ 1 ] + ny * r, p[ 2 ] + nz * r );
			nrm.push( nx, ny, nz );
			uv.push( j / radialSegs, i / ( pts.length - 1 ) );
			col.push( c[ 0 ], c[ 1 ], c[ 2 ] );
			wind.push( w );

		}

	}
	for ( let i = 0; i < pts.length - 1; i ++ ) {

		for ( let j = 0; j < radialSegs; j ++ ) {

			const a = baseV + i * stride + j;
			const b = a + 1;
			const c = a + stride;
			const d = c + 1;
			// Outward-facing CCW winding matching fU x fV = tan
			idx.push( a, b, c, b, d, c );

		}

	}

}

function appendSolidDome(
	pos: number[],
	nrm: number[],
	uv: number[],
	col: number[],
	wind: number[],
	idx: number[],
	center: [ number, number, number ],
	rx: number,
	ry: number,
	innerColor: [ number, number, number ],
	outerColor: [ number, number, number ],
	windW = 1.0,
): void {

	const rings = 6;
	const segs = 18;
	const baseV = pos.length / 3;
	const stride = segs + 1;
	for ( let r = 0; r <= rings; r ++ ) {

		const frac = r / rings;
		const phi = frac * Math.PI * 0.52;
		const rad = Math.sin( phi ) * rx;
		const h = Math.cos( phi ) * ry;
		for ( let s = 0; s <= segs; s ++ ) {

			const th = ( s / segs ) * Math.PI * 2;
			const nx = Math.sin( phi ) * Math.cos( th );
			const ny = Math.cos( phi );
			const nz = Math.sin( phi ) * Math.sin( th );
			pos.push( center[ 0 ] + Math.cos( th ) * rad, center[ 1 ] + h, center[ 2 ] + Math.sin( th ) * rad );
			nrm.push( nx, ny, nz );
			uv.push( s / segs, frac );
			col.push(
				innerColor[ 0 ] * ( 1 - frac ) + outerColor[ 0 ] * frac,
				innerColor[ 1 ] * ( 1 - frac ) + outerColor[ 1 ] * frac,
				innerColor[ 2 ] * ( 1 - frac ) + outerColor[ 2 ] * frac,
			);
			wind.push( windW );

		}

	}
	for ( let r = 0; r < rings; r ++ ) {

		for ( let s = 0; s < segs; s ++ ) {

			const a = baseV + r * stride + s;
			const b = a + 1;
			const c = a + stride;
			const d = c + 1;
			// Outward-facing CCW winding: cross(theta_dir, radial_out_dir) points +Y up
			idx.push( a, b, c, b, d, c );

		}

	}

}

export function buildFlowerClump( preset: FlowerPresetId, seed = 17, heightMeters = 0.48 ): FlowerBuffers {

	const rng = new Mulberry32( seed );
	const sPos: number[] = [];
	const sNrm: number[] = [];
	const sUv: number[] = [];
	const sCol: number[] = [];
	const sWind: number[] = [];
	const sIdx: number[] = [];

	const pPos: number[] = [];
	const pNrm: number[] = [];
	const pUv: number[] = [];
	const pCol: number[] = [];
	const pWind: number[] = [];
	const pIdx: number[] = [];

	const cPos: number[] = [];
	const cNrm: number[] = [];
	const cUv: number[] = [];
	const cCol: number[] = [];
	const cWind: number[] = [];
	const cIdx: number[] = [];

	// Curved stem from root embed (-0.03m) up to flower receptacle
	const stemSegs = 9;
	const leanX = rng.signed() * 0.055;
	const leanZ = rng.signed() * 0.055;
	const stemPts: Array<[ number, number, number ]> = [];
	const stemRads: number[] = [];
	const stemCols: Array<[ number, number, number ]> = [];
	const embedY = - 0.03;

	for ( let i = 0; i <= stemSegs; i ++ ) {

		const t = i / stemSegs;
		const arch = Math.sin( t * Math.PI * 0.7 );
		stemPts.push( [
			leanX * ( t * 0.7 + arch * 0.4 ),
			embedY + ( heightMeters - embedY ) * t,
			leanZ * ( t * 0.7 + arch * 0.4 ),
		] );
		stemRads.push( ( preset === 'tulip' ? 0.011 : 0.0075 ) * ( 1.15 - 0.35 * t ) );
		stemCols.push( [ 0.16 + 0.07 * t, 0.34 + 0.15 * t, 0.11 + 0.04 * t ] );

	}
	appendTaperedTube( sPos, sNrm, sUv, sCol, sWind, sIdx, stemPts, stemRads, stemCols, 8, heightMeters );

	// Cauline stem leaves (with V-shaped midrib crease & non-zero attachment width)
	const leafCount = preset === 'tulip' ? 2 : 3;
	for ( let l = 0; l < leafCount; l ++ ) {

		const tAttach = preset === 'tulip' ? ( 0.12 + l * 0.14 ) : ( 0.25 + l * 0.22 );
		const idxF = tAttach * stemSegs;
		const i0 = Math.floor( idxF );
		const baseP = stemPts[ i0 ]!;
		const az = l * GOLDEN_ANGLE + rng.range( 0.1, 0.5 );
		const leafLen = preset === 'tulip' ? heightMeters * 0.52 : heightMeters * 0.28;
		const leafW = preset === 'tulip' ? 0.055 : 0.042;

		appendCurvedRibbon( sPos, sNrm, sUv, sCol, sWind, sIdx, 6, 8, ( u, v ) => {

			const envBase = preset === 'tulip'
				? Math.sin( Math.pow( 0.08 + 0.88 * v, 0.7 ) * Math.PI )
				: Math.sin( ( 0.08 + 0.88 * v ) * Math.PI ) * ( 1 + 0.08 * Math.sin( v * Math.PI * 6 ) );
			const widthEnv = Math.max( 0.06, envBase );
			const s = ( u - 0.5 ) * 2;
			const reach = v * leafLen;
			const rise = Math.sin( v * Math.PI * 0.65 ) * leafLen * ( preset === 'tulip' ? 0.92 : 0.35 ) - v * v * leafLen * 0.22;
			const vCrease = Math.abs( s ) * 0.008 * ( 1 - v * 0.5 );
			const side = s * leafW * widthEnv;
			const ca = Math.cos( az );
			const sa = Math.sin( az );
			return {
				p: [
					baseP[ 0 ] + ca * reach - sa * side,
					baseP[ 1 ] + rise + vCrease,
					baseP[ 2 ] + sa * reach + ca * side,
				],
				c: [ 0.16 + 0.12 * v, 0.38 + 0.16 * v, 0.11 + 0.04 * v ],
				w: Math.min( 1, ( baseP[ 1 ] + rise ) / heightMeters ),
			};

		} );

	}

	const head = stemPts[ stemPts.length - 1 ]!;
	const headTiltX = leanX * 1.1;
	const headTiltZ = leanZ * 1.1;

	// Solid green receptacle calyx cup cradling the petals/sepals
	appendSolidDome(
		sPos, sNrm, sUv, sCol, sWind, sIdx,
		[ head[ 0 ], head[ 1 ] - 0.008, head[ 2 ] ],
		preset === 'daisy' ? 0.024 : 0.018,
		0.011,
		[ 0.16, 0.34, 0.10 ],
		[ 0.22, 0.42, 0.14 ],
		1.0,
	);

	// Green calyx sepals under the bloom (Daisy / Rose) — non-zero tip width prevents black tips!
	const sepalCount = preset === 'daisy' ? 10 : preset === 'rose' ? 5 : 0;
	for ( let k = 0; k < sepalCount; k ++ ) {

		const az = ( k / sepalCount ) * Math.PI * 2 + rng.signed() * 0.08;
		const sepLen = preset === 'daisy' ? 0.034 : 0.048;
		const sepW = preset === 'daisy' ? 0.011 : 0.015;
		appendCurvedRibbon( sPos, sNrm, sUv, sCol, sWind, sIdx, 3, 5, ( u, v ) => {

			const s = ( u - 0.5 ) * 2;
			const wEnv = Math.max( 0.06, ( 1 - 0.92 * v ) * Math.sqrt( Math.max( 0.08, 1 - v * 0.5 ) ) );
			const r = 0.010 + v * sepLen;
			const yOff = - 0.003 - v * v * 0.016;
			const ca = Math.cos( az );
			const sa = Math.sin( az );
			return {
				p: [
					head[ 0 ] + ca * r - sa * s * sepW * wEnv,
					head[ 1 ] + yOff,
					head[ 2 ] + sa * r + ca * s * sepW * wEnv,
				],
				c: [ 0.19, 0.39, 0.12 ],
				w: 0.95,
			};

		} );

	}

	// Sculpted Multi-Whorl 3D Petals
	if ( preset === 'daisy' ) {

		const nPetals = 24;
		for ( let p = 0; p < nPetals; p ++ ) {

			const whorl = p % 2;
			const az = ( p / nPetals ) * Math.PI * 2 + rng.signed() * 0.05;
			const pLen = rng.range( 0.072, 0.088 );
			const pW = rng.range( 0.013, 0.016 );
			const droop = ( whorl === 0 ? - 0.014 : 0.006 ) + rng.signed() * 0.006;
			const flutter = rng.signed() * 0.004;

			appendCurvedRibbon( pPos, pNrm, pUv, pCol, pWind, pIdx, 6, 9, ( u, v ) => {

				const s = ( u - 0.5 ) * 2;
				// Non-zero claw attachment & smooth rounded apex (no zero-cross-product black ring!)
				const widthProfile = 0.18 + 0.82 * Math.sin( Math.pow( 0.06 + 0.92 * v, 0.52 ) * Math.PI );
				const veinPleat = Math.cos( s * Math.PI * 1.5 ) * 0.0010 * Math.sin( v * Math.PI );
				const cup = ( s * s ) * 0.0022 * Math.sin( v * Math.PI );
				const r = 0.020 + v * pLen;
				const yOff = 0.007 + Math.sin( v * Math.PI * 0.68 ) * 0.011 + droop * v * v + cup + veinPleat + s * flutter * v;
				const ca = Math.cos( az );
				const sa = Math.sin( az );
				// Warm cream-gold throat transitioning to crisp luminous ivory-white
				const throat = Math.exp( - v * 6.0 );
				return {
					p: [
						head[ 0 ] + ca * r - sa * s * pW * widthProfile + headTiltX * v * 0.20,
						head[ 1 ] + yOff,
						head[ 2 ] + sa * r + ca * s * pW * widthProfile + headTiltZ * v * 0.20,
					],
					c: [ 0.98 - 0.02 * throat, 0.96 - 0.08 * throat, 0.96 - 0.36 * throat ],
					w: 1.0,
				};

			} );

		}

		// Solid domed golden-amber receptacle cushion directly under the Fibonacci florets
		const discRadius = 0.025;
		appendSolidDome(
			cPos, cNrm, cUv, cCol, cWind, cIdx,
			[ head[ 0 ], head[ 1 ] + 0.005, head[ 2 ] ],
			discRadius * 1.02,
			0.013,
			[ 0.36, 0.14, 0.005 ],
			[ 0.72, 0.42, 0.02 ],
			1.0,
		);

		// Golden Fibonacci spiral central disc florets packed on top of cushion
		const nFlorets = 140;
		for ( let f = 0; f < nFlorets; f ++ ) {

			const frac = Math.sqrt( ( f + 0.5 ) / nFlorets );
			const r = frac * discRadius * 0.95;
			const th = f * GOLDEN_ANGLE;
			const domeH = 0.013 * Math.cos( frac * Math.PI * 0.52 );
			const fx = head[ 0 ] + Math.cos( th ) * r;
			const fy = head[ 1 ] + 0.005 + domeH;
			const fz = head[ 2 ] + Math.sin( th ) * r;
			const fr = 0.0024 * ( 0.85 + 0.30 * frac );
			const baseV = cPos.length / 3;
			const tips: Array<[ number, number, number ]> = [
				[ fx, fy + fr * 1.25, fz ],
				[ fx + fr, fy, fz ],
				[ fx, fy, fz + fr ],
				[ fx - fr, fy, fz ],
				[ fx, fy, fz - fr ],
			];
			const normals: Array<[ number, number, number ]> = [
				[ 0, 1, 0 ], [ 0.7, 0.7, 0 ], [ 0, 0.7, 0.7 ], [ - 0.7, 0.7, 0 ], [ 0, 0.7, - 0.7 ],
			];
			for ( let k = 0; k < 5; k ++ ) {

				cPos.push( tips[ k ]![ 0 ], tips[ k ]![ 1 ], tips[ k ]![ 2 ] );
				cNrm.push( normals[ k ]![ 0 ], normals[ k ]![ 1 ], normals[ k ]![ 2 ] );
				cUv.push( frac, ( f % 8 ) / 8 );
				cCol.push( 0.72 + 0.22 * frac, 0.28 + 0.36 * frac, 0.01 + 0.04 * frac );
				cWind.push( 1.0 );

			}
			cIdx.push(
				baseV, baseV + 2, baseV + 1,
				baseV, baseV + 3, baseV + 2,
				baseV, baseV + 4, baseV + 3,
				baseV, baseV + 1, baseV + 4,
			);

		}

	} else if ( preset === 'rose' ) {

		// 3 concentric smooth overlapping cupped rose whorls (18 sculpted broad obovate petals)
		const whorls = [
			{ count: 5, radius: 0.007, len: 0.044, width: 0.025, openDeg: 18, curlOut: 0.10 },
			{ count: 6, radius: 0.011, len: 0.056, width: 0.032, openDeg: 40, curlOut: 0.24 },
			{ count: 7, radius: 0.014, len: 0.066, width: 0.038, openDeg: 66, curlOut: 0.38 },
		];
		for ( let wIdx = 0; wIdx < whorls.length; wIdx ++ ) {

			const wh = whorls[ wIdx ]!;
			for ( let p = 0; p < wh.count; p ++ ) {

				const az = p * GOLDEN_ANGLE + wIdx * 0.9 + rng.signed() * 0.10;
				const tiltRad = ( wh.openDeg * Math.PI ) / 180;

				appendCurvedRibbon( pPos, pNrm, pUv, pCol, pWind, pIdx, 10, 10, ( u, v ) => {

					const s = ( u - 0.5 ) * 2;
					const wEnv = 0.14 + 0.86 * Math.sin( Math.pow( 0.06 + 0.90 * v, 0.45 ) * Math.PI );
					// Smooth domed top arc across u so outer rose petals curve naturally instead of clipping flat
					const domeArch = ( 1.0 - s * s * 0.8 ) * 0.007 * Math.pow( v, 1.4 );
					const gentleWave = Math.cos( s * Math.PI * 0.6 ) * 0.0012 * v;
					const cupDepth = ( 1.0 - s * s ) * 0.011 * Math.sin( v * Math.PI );
					const lipCurl = Math.pow( Math.max( 0, v - 0.62 ) / 0.38, 2 ) * wh.curlOut * 0.020;

					const dist = wh.radius + Math.sin( tiltRad ) * ( v * wh.len + domeArch ) + lipCurl - cupDepth * 0.35;
					const yOff = Math.cos( tiltRad ) * ( v * wh.len + domeArch ) - lipCurl * 0.50 + gentleWave;
					const ca = Math.cos( az );
					const sa = Math.sin( az );
					// Linear PBR rose crimson throat -> luminous blush pink edge
					const edge = Math.pow( v, 0.8 );
					return {
						p: [
							head[ 0 ] + ca * dist - sa * s * wh.width * wEnv,
							head[ 1 ] + 0.004 + yOff,
							head[ 2 ] + sa * dist + ca * s * wh.width * wEnv,
						],
						c: [ 0.38 + 0.48 * edge, 0.03 + 0.25 * edge * edge, 0.09 + 0.24 * edge * edge ],
						w: 1.0,
					};

				} );

			}

		}

		// Golden stamen ring + central yellow carpel dome
		appendSolidDome(
			cPos, cNrm, cUv, cCol, cWind, cIdx,
			[ head[ 0 ], head[ 1 ] + 0.010, head[ 2 ] ],
			0.009, 0.006,
			[ 0.55, 0.36, 0.04 ], [ 0.85, 0.60, 0.08 ],
			1.0,
		);
		for ( let a = 0; a < 22; a ++ ) {

			const th = a * GOLDEN_ANGLE;
			const r = 0.005 + ( a / 22 ) * 0.008;
			const sx = head[ 0 ] + Math.cos( th ) * r;
			const sy = head[ 1 ] + 0.016 + rng.next() * 0.006;
			const sz = head[ 2 ] + Math.sin( th ) * r;
			const ar = 0.0018;
			const baseV = cPos.length / 3;
			cPos.push( sx, sy + ar, sz, sx + ar, sy, sz, sx, sy, sz + ar, sx - ar, sy, sz, sx, sy, sz - ar );
			cNrm.push( 0, 1, 0, 1, 0, 0, 0, 0, 1, - 1, 0, 0, 0, 0, - 1 );
			for ( let k = 0; k < 5; k ++ ) {

				cUv.push( 0.5, 0.5 );
				cCol.push( 0.85, 0.56, 0.05 );
				cWind.push( 1.0 );

			}
			cIdx.push(
				baseV, baseV + 2, baseV + 1,
				baseV, baseV + 3, baseV + 2,
				baseV, baseV + 4, baseV + 3,
				baseV, baseV + 1, baseV + 4,
			);

		}

	} else {

		// Garden Tulip: 6 high-resolution smooth rounded teardrop cupped tepals (2 whorls of 3)
		for ( let p = 0; p < 6; p ++ ) {

			const outer = p < 3;
			const az = ( ( p % 3 ) / 3 ) * Math.PI * 2 + ( outer ? 0 : Math.PI / 3 ) + rng.signed() * 0.04;
			const rOff = outer ? 0.010 : 0.006;
			const pLen = 0.092;
			const pW = 0.030;

			appendCurvedRibbon( pPos, pNrm, pUv, pCol, pWind, pIdx, 10, 12, ( u, v ) => {

				const s = ( u - 0.5 ) * 2;
				// Smooth oval-teardrop tepal tapering gently into a rounded pointed apex (no flat top cut!)
				const widthEnv = 0.08 + 0.92 * Math.sin( Math.pow( 0.04 + 0.93 * v, 0.62 ) * Math.PI );
				const roundedTipY = ( 1.0 - s * s * 0.85 ) * 0.011 * Math.pow( v, 2.0 );
				const gobletProfile = Math.sin( v * Math.PI * 0.84 ) * ( outer ? 0.029 : 0.023 );
				const cup = ( 1.0 - s * s ) * 0.012 * Math.sin( v * Math.PI );
				const dist = rOff + gobletProfile - cup * 0.35;
				const yOff = Math.pow( v, 0.88 ) * pLen + roundedTipY;
				const ca = Math.cos( az );
				const sa = Math.sin( az );
				const flame = Math.pow( v, 1.35 );
				// Rich linear velvet scarlet-crimson throat -> luminous coral-gold flame margin
				return {
					p: [
						head[ 0 ] + ca * dist - sa * s * pW * widthEnv,
						head[ 1 ] + yOff,
						head[ 2 ] + sa * dist + ca * s * pW * widthEnv,
					],
					c: [ 0.45 + 0.46 * flame, 0.025 + 0.24 * flame * ( Math.abs( s ) * 0.45 + 0.55 ), 0.02 + 0.04 * flame ],
					w: 1.0,
				};

			} );

		}

		// Central pistil & 6 dark pollen anthers
		for ( let a = 0; a < 6; a ++ ) {

			const th = ( a / 6 ) * Math.PI * 2;
			const sx = head[ 0 ] + Math.cos( th ) * 0.008;
			const sy = head[ 1 ] + 0.042;
			const sz = head[ 2 ] + Math.sin( th ) * 0.008;
			const ar = 0.003;
			const baseV = cPos.length / 3;
			cPos.push( sx, sy + ar * 2.5, sz, sx + ar, sy, sz, sx, sy, sz + ar, sx - ar, sy, sz, sx, sy, sz - ar );
			cNrm.push( 0, 1, 0, 1, 0, 0, 0, 0, 1, - 1, 0, 0, 0, 0, - 1 );
			for ( let k = 0; k < 5; k ++ ) {

				cUv.push( 0.5, 0.5 );
				cCol.push( 0.22, 0.14, 0.18 );
				cWind.push( 1.0 );

			}
			cIdx.push(
				baseV, baseV + 2, baseV + 1,
				baseV, baseV + 3, baseV + 2,
				baseV, baseV + 4, baseV + 3,
				baseV, baseV + 1, baseV + 4,
			);

		}

	}

	return {
		stemsAndLeaves: {
			positions: new Float32Array( sPos ),
			normals: new Float32Array( sNrm ),
			uvs: new Float32Array( sUv ),
			colors: new Float32Array( sCol ),
			windWeights: new Float32Array( sWind ),
			indices: new Uint32Array( sIdx ),
		},
		petals: {
			positions: new Float32Array( pPos ),
			normals: new Float32Array( pNrm ),
			uvs: new Float32Array( pUv ),
			colors: new Float32Array( pCol ),
			windWeights: new Float32Array( pWind ),
			indices: new Uint32Array( pIdx ),
		},
		centerDisc: {
			positions: new Float32Array( cPos ),
			normals: new Float32Array( cNrm ),
			uvs: new Float32Array( cUv ),
			colors: new Float32Array( cCol ),
			windWeights: new Float32Array( cWind ),
			indices: new Uint32Array( cIdx ),
		},
	};

}

/**
 * Photorealistic V-Creased Curved Grass Clump + Connected Golden Seed Spikes (`fescue`, `foxtail`, `sedge`).
 */
export function buildGrassClump( preset: GrassPresetId, seed = 91, bladeCount = 28 ): MeshBuffers {

	const rng = new Mulberry32( seed );
	const pos: number[] = [];
	const nrm: number[] = [];
	const uv: number[] = [];
	const col: number[] = [];
	const wind: number[] = [];
	const idx: number[] = [];

	const segs = 5;
	const baseH = preset === 'foxtail' ? 0.52 : preset === 'sedge' ? 0.34 : 0.40;
	const baseW = preset === 'sedge' ? 0.016 : 0.0095;

	for ( let b = 0; b < bladeCount; b ++ ) {

		const az = b * GOLDEN_ANGLE + rng.signed() * 0.4;
		const rOff = Math.sqrt( rng.next() ) * 0.055;
		const ox = Math.cos( az ) * rOff;
		const oz = Math.sin( az ) * rOff;
		const bH = baseH * rng.range( 0.62, 1.30 );
		const bW = baseW * rng.range( 0.80, 1.25 );
		const bend = rng.range( 0.14, 0.38 ) * bH;
		const twist = rng.signed() * 0.42;
		const isDryTip = rng.next() < 0.18;

		const ca = Math.cos( az );
		const sa = Math.sin( az );
		const baseV = pos.length / 3;

		for ( let s = 0; s <= segs; s ++ ) {

			const t = s / segs;
			const reach = bend * ( t * t );
			const y = - 0.015 + bH * ( t - 0.14 * t * t * t );
			const w = bW * Math.pow( Math.max( 0.02, 1.0 - t ), 0.72 );
			const midDepth = w * 0.35;

			const cx = ox + ca * reach;
			const cz = oz + sa * reach;

			const tAngle = az + twist * t;
			const tx = - Math.sin( tAngle );
			const tz = Math.cos( tAngle );

			// Lush emerald-olive meadow chlorophyll gradient with root AO
			const ao = 0.28 + 0.72 * Math.min( 1, t * 2.2 );
			const tipYellow = isDryTip ? Math.pow( t, 2.0 ) * 0.48 : Math.pow( t, 2.8 ) * 0.18;
			const rCol = ( 0.12 + 0.20 * t + tipYellow * 0.55 ) * ao;
			const gCol = ( 0.34 + 0.24 * t + tipYellow * 0.10 ) * ao;
			const bCol = ( 0.07 + 0.05 * t ) * ao;

			const nxL = norm3( tx * - 0.45 - ca * 0.2, 0.82, tz * - 0.45 - sa * 0.2 );
			const nxM = norm3( - ca * 0.25, 0.96, - sa * 0.25 );
			const nxR = norm3( tx * 0.45 - ca * 0.2, 0.82, tz * 0.45 - sa * 0.2 );

			pos.push( cx - tx * w, y, cz - tz * w );
			nrm.push( nxL[ 0 ], nxL[ 1 ], nxL[ 2 ] );
			uv.push( 0, t );
			col.push( rCol, gCol, bCol );
			wind.push( t );

			pos.push( cx + ca * midDepth, y + midDepth * 0.3, cz + sa * midDepth );
			nrm.push( nxM[ 0 ], nxM[ 1 ], nxM[ 2 ] );
			uv.push( 0.5, t );
			col.push( rCol * 1.08, gCol * 1.08, bCol * 1.05 );
			wind.push( t );

			pos.push( cx + tx * w, y, cz + tz * w );
			nrm.push( nxR[ 0 ], nxR[ 1 ], nxR[ 2 ] );
			uv.push( 1, t );
			col.push( rCol, gCol, bCol );
			wind.push( t );

		}

		for ( let s = 0; s < segs; s ++ ) {

			const r0 = baseV + s * 3;
			const r1 = r0 + 3;
			if ( s < segs - 1 ) {

				idx.push(
					r0, r0 + 1, r1, r0 + 1, r1 + 1, r1,
					r0 + 1, r0 + 2, r1 + 1, r0 + 2, r1 + 2, r1 + 1,
				);

			} else {

				idx.push( r0, r0 + 1, r1 + 1, r0 + 1, r0 + 2, r1 + 1 );

			}

		}

		// Connected tall flowering culm + golden plumose foxtail spikelet cluster (every 6th blade)
		if ( preset === 'foxtail' && b % 6 === 0 ) {

			const stemH = bH * 1.15;
			const culmPts: Array<[ number, number, number ]> = [
				[ ox, - 0.015, oz ],
				[ ox + ca * bend * 0.35, stemH * 0.45, oz + sa * bend * 0.35 ],
				[ ox + ca * bend * 0.85, stemH * 0.92, oz + sa * bend * 0.85 ],
			];
			appendTaperedTube(
				pos, nrm, uv, col, wind, idx,
				culmPts,
				[ 0.0022, 0.0018, 0.0013 ],
				[ [ 0.35, 0.45, 0.22 ], [ 0.55, 0.60, 0.28 ], [ 0.78, 0.68, 0.38 ] ],
				4,
				stemH,
			);

			// Slender golden wheat/foxtail panicle tapering smoothly at both ends (warm linear straw gold)
			const panBase = culmPts[ 2 ]!;
			const panLen = 0.075;
			const nSpikeRings = 8;
			const nRadial = 5;
			const panV = pos.length / 3;
			for ( let r = 0; r <= nSpikeRings; r ++ ) {

				const u = r / nSpikeRings;
				const py = panBase[ 1 ] - panLen * 0.65 + u * panLen;
				const pRad = 0.0040 * Math.sin( u * Math.PI ) + 0.0005;
				const px = panBase[ 0 ] + ca * u * 0.012;
				const pz = panBase[ 2 ] + sa * u * 0.012;
				for ( let j = 0; j <= nRadial; j ++ ) {

					const th = ( j / nRadial ) * Math.PI * 2 + r * 0.6;
					const nx = Math.cos( th );
					const nz = Math.sin( th );
					pos.push( px + nx * pRad, py, pz + nz * pRad );
					nrm.push( nx * 0.7, 0.72, nz * 0.7 );
					uv.push( j / nRadial, u );
					// Rich golden-amber straw in linear space (not chalky white!)
					col.push( 0.54 + 0.14 * u, 0.36 + 0.12 * u, 0.08 + 0.04 * u );
					wind.push( 1.0 );

				}

			}
			const pStride = nRadial + 1;
			for ( let r = 0; r < nSpikeRings; r ++ ) {

				for ( let j = 0; j < nRadial; j ++ ) {

					const a = panV + r * pStride + j;
					const c = a + pStride;
					idx.push( a, c, a + 1, a + 1, c, c + 1 );

				}

			}

		}

	}

	return {
		positions: new Float32Array( pos ),
		normals: new Float32Array( nrm ),
		uvs: new Float32Array( uv ),
		colors: new Float32Array( col ),
		windWeights: new Float32Array( wind ),
		indices: new Uint32Array( idx ),
	};

}
