/**
 * Nanite-style Cluster DAG `max`-error hierarchy & screen-space LOD cut evaluator.
 * Pure data / Zero Three.js dependencies.
 */

export interface BoundingSphere {
	center: [ number, number, number ];
	radius: number;
}

export interface ClusterNode {
	id: number;
	level: number;
	triangleCount: number;
	sphere: BoundingSphere;
	maxError: number;
	parentError: number;
	children: number[];
	isLeaf: boolean;
}

export function mergeBoundingSpheres( spheres: BoundingSphere[] ): BoundingSphere {

	if ( spheres.length === 0 ) return { center: [ 0, 0, 0 ], radius: 0 };
	let cx = 0;
	let cy = 0;
	let cz = 0;
	for ( const s of spheres ) {

		cx += s.center[ 0 ];
		cy += s.center[ 1 ];
		cz += s.center[ 2 ];

	}
	cx /= spheres.length;
	cy /= spheres.length;
	cz /= spheres.length;
	let r = 0;
	for ( const s of spheres ) {

		const d = Math.hypot( s.center[ 0 ] - cx, s.center[ 1 ] - cy, s.center[ 2 ] - cz ) + s.radius;
		if ( d > r ) r = d;

	}
	return { center: [ cx, cy, cz ], radius: r };

}

/**
 * Propagate errors monotonically upward using `max(childError)` + geometric simplification error
 * so children never exceed parentError (prevents screen-space popping/cracks in threejs-nanites).
 */
export function buildClusterDagHierarchy(
	leafNodes: Array<{ sphere: BoundingSphere; triangleCount: number; localError?: number }>,
	branchFactor = 4,
): ClusterNode[] {

	const nodes: ClusterNode[] = [];
	let currentLevelIds: number[] = [];

	for ( let i = 0; i < leafNodes.length; i ++ ) {

		const leaf = leafNodes[ i ]!;
		const id = nodes.length;
		nodes.push( {
			id,
			level: 0,
			triangleCount: leaf.triangleCount,
			sphere: leaf.sphere,
			maxError: leaf.localError ?? 0,
			parentError: Infinity,
			children: [],
			isLeaf: true,
		} );
		currentLevelIds.push( id );

	}

	let level = 1;
	while ( currentLevelIds.length > 1 ) {

		const nextLevelIds: number[] = [];
		for ( let i = 0; i < currentLevelIds.length; i += branchFactor ) {

			const groupIds = currentLevelIds.slice( i, i + branchFactor );
			const childNodes = groupIds.map( ( cid ) => nodes[ cid ]! );
			const mergedSphere = mergeBoundingSpheres( childNodes.map( ( c ) => c.sphere ) );
			const maxChildError = childNodes.reduce( ( acc, c ) => Math.max( acc, c.maxError ), 0 );
			const parentGeometricError = maxChildError + Math.max( 0.01, mergedSphere.radius * 0.04 * level );

			for ( const c of childNodes ) {

				c.parentError = parentGeometricError;

			}

			const parentId = nodes.length;
			nodes.push( {
				id: parentId,
				level,
				triangleCount: Math.max( 16, Math.round( childNodes.reduce( ( s, c ) => s + c.triangleCount, 0 ) * 0.5 ) ),
				sphere: mergedSphere,
				maxError: parentGeometricError,
				parentError: Infinity,
				children: groupIds,
				isLeaf: false,
			} );
			nextLevelIds.push( parentId );

		}
		currentLevelIds = nextLevelIds;
		level ++;

	}

	return nodes;

}

export function selectLodCut(
	nodes: ClusterNode[],
	cameraPos: [ number, number, number ],
	projScalePx: number,
	maxPixelError = 1.0,
): ClusterNode[] {

	const selected: ClusterNode[] = [];
	const projectErrorPx = ( sphere: BoundingSphere, err: number ): number => {

		if ( ! Number.isFinite( err ) ) return Infinity;
		const dist = Math.max( 0.01, Math.hypot(
			sphere.center[ 0 ] - cameraPos[ 0 ],
			sphere.center[ 1 ] - cameraPos[ 1 ],
			sphere.center[ 2 ] - cameraPos[ 2 ],
		) - sphere.radius );
		return ( err / dist ) * projScalePx;

	};

	for ( const node of nodes ) {

		const ownPx = projectErrorPx( node.sphere, node.maxError );
		const parentPx = projectErrorPx( node.sphere, node.parentError );
		if ( ownPx <= maxPixelError && parentPx > maxPixelError ) {

			selected.push( node );

		}

	}
	return selected;

}
