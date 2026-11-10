/**
 * Three.js Photorealistic Botanical Builders & Procedural Sky/IBL Environment
 * Fuses Surface::shaped PBR, coverage-preserving alpha mipmaps, upNormalCards,
 * 3-level recursive tree skeletons, sculpted 3D flowers, V-creased grass tufts,
 * and quadratic wind sway shaders.
 */

import * as THREE from 'three';
import {
	Mulberry32,
	WATER_LEVEL,
	buildFlagstoneSlabGeometry,
	buildFlowerClump,
	buildFountainWaterStreamsGeometry,
	buildGrassClump,
	buildScholarRockMesh,
	buildStoneFountainGeometry,
	buildWeatheredRock,
	distanceToPathSpine,
	generateRealisticTree,
	granitePresetSurface,
	lakeSignedDistance,
	planBotanicalGardenLayout,
	sampleGardenTerrainHeight,
	synthesizeBarkSurface,
	synthesizeCarvedLimestoneSurface,
	synthesizeFlagstoneSlateSurface,
	synthesizeLeafSprigAtlas,
	synthesizeScholarRockSurface,
	synthesizeSoilSurface,
	synthesizeWaterNormalMap,
	type FlowerPresetId,
	type GardenLayoutPlan,
	type GrassPresetId,
	type TreePresetId,
} from '../core/index.ts';
import { buffersToThreeGeometry, shapedSurfaceToThreeTextures } from './createThreeSurface.ts';

export interface WindUniforms {
	uTime: { value: number };
	uWindStrength: { value: number };
}

export function attachWindSway( material: THREE.Material, uniforms: WindUniforms, swayAmp = 0.08 ): void {

	const prevKey = material.customProgramCacheKey?.() ?? '';
	material.onBeforeCompile = ( shader ) => {

		shader.uniforms.uTime = uniforms.uTime;
		shader.uniforms.uWindStrength = uniforms.uWindStrength;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
				attribute float aWind;
				uniform float uTime;
				uniform float uWindStrength;`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				#ifdef USE_INSTANCING
					vec4 wpRef = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
					float phase = wpRef.x * 1.4 + wpRef.z * 1.1;
				#else
					float phase = position.x * 1.3 + position.z * 1.1;
				#endif
				float gust = sin(uTime * 1.85 + phase) * 0.65 + sin(uTime * 3.7 + phase * 1.9) * 0.35;
				float bend = pow(clamp(aWind, 0.0, 1.0), 1.65) * uWindStrength * ${ swayAmp.toFixed( 4 ) };
				transformed.x += gust * bend;
				transformed.z += cos(uTime * 1.3 + phase * 0.8) * bend * 0.45;`,
			);

	};
	material.customProgramCacheKey = () => `${ prevKey }-wind-${ swayAmp }`;

}

export function buildProceduralSkyDomeAndPMREM( renderer: THREE.WebGLRenderer ): {
	skyDome: THREE.Mesh;
	envMap: THREE.Texture;
} {

	const skyGeo = new THREE.SphereGeometry( 120, 48, 32 );
	const skyMat = new THREE.ShaderMaterial( {
		side: THREE.BackSide,
		depthWrite: false,
		uniforms: {
			uSunDir: { value: new THREE.Vector3( 13, 10.5, 8.5 ).normalize() },
		},
		vertexShader: `
			varying vec3 vWorldDir;
			void main() {
				vec4 wp = modelMatrix * vec4(position, 1.0);
				vWorldDir = normalize(position);
				gl_Position = projectionMatrix * viewMatrix * wp;
			}
		`,
		fragmentShader: `
			varying vec3 vWorldDir;
			uniform vec3 uSunDir;
			void main() {
				vec3 dir = normalize(vWorldDir);
				float h = clamp(dir.y, -0.2, 1.0);
				vec3 zenith = vec3(0.13, 0.35, 0.70);
				vec3 horizon = vec3(0.76, 0.85, 0.94);
				vec3 ground = vec3(0.18, 0.22, 0.14);
				vec3 col = h >= 0.0
					? mix(horizon, zenith, pow(h, 0.48))
					: mix(horizon, ground, clamp(-h * 4.0, 0.0, 1.0));
				float sunDot = max(0.0, dot(dir, uSunDir));
				col += vec3(1.0, 0.84, 0.56) * pow(sunDot, 10.0) * 0.42;
				col += vec3(1.5, 1.32, 0.96) * smoothstep(0.996, 0.9995, sunDot);
				gl_FragColor = vec4(col, 1.0);
			}
		`,
	} );
	const skyDome = new THREE.Mesh( skyGeo, skyMat );

	const pmremScene = new THREE.Scene();
	pmremScene.add( new THREE.Mesh( skyGeo, skyMat ) );
	const pmremGen = new THREE.PMREMGenerator( renderer );
	const envRT = pmremGen.fromScene( pmremScene, 0.03 );
	pmremGen.dispose();

	return { skyDome, envMap: envRT.texture };

}

export function buildTreeMeshGroup(
	preset: TreePresetId,
	seed: number,
	windUniforms: WindUniforms,
	options: { showLeaves?: boolean; useNormalMap?: boolean; wireframe?: boolean; heightScale?: number } = {},
): THREE.Group {

	const showLeaves = options.showLeaves ?? true;
	const useNormal = options.useNormalMap ?? true;
	const wireframe = options.wireframe ?? false;

	const treeData = generateRealisticTree( { preset, seed, heightScale: options.heightScale ?? 1.0 } );
	const barkTex = shapedSurfaceToThreeTextures( synthesizeBarkSurface( preset, 256, seed ), 2 );

	const barkMat = new THREE.MeshStandardMaterial( {
		map: barkTex.map,
		normalMap: useNormal ? barkTex.normalMap : null,
		normalScale: new THREE.Vector2( 1.25, 1.25 ),
		aoMap: barkTex.ormMap,
		roughnessMap: barkTex.ormMap,
		roughness: 0.95,
		metalness: 0.0,
		vertexColors: true,
		wireframe,
	} );

	const group = new THREE.Group();
	group.name = `tree_${ preset }`;

	const barkGeo = buffersToThreeGeometry( treeData.bark );
	const barkMesh = new THREE.Mesh( barkGeo, barkMat );
	barkMesh.name = 'bark';
	barkMesh.castShadow = true;
	barkMesh.receiveShadow = true;
	group.add( barkMesh );

	if ( showLeaves ) {

		const atlas = synthesizeLeafSprigAtlas( preset, 256, 0.45 );
		const m0 = atlas.albedoMips[ 0 ]!;
		const leafMap = new THREE.DataTexture( m0.data, m0.width, m0.height, THREE.RGBAFormat );
		leafMap.colorSpace = THREE.SRGBColorSpace;
		leafMap.mipmaps = atlas.albedoMips.map( ( m ) => ( { data: m.data, width: m.width, height: m.height } ) );
		leafMap.generateMipmaps = false;
		leafMap.minFilter = THREE.LinearMipmapLinearFilter;
		leafMap.magFilter = THREE.LinearFilter;
		leafMap.needsUpdate = true;

		const leafNormal = new THREE.DataTexture( atlas.normalLinear, atlas.size, atlas.size, THREE.RGBAFormat );
		leafNormal.colorSpace = THREE.NoColorSpace;
		leafNormal.generateMipmaps = true;
		leafNormal.needsUpdate = true;

		const leafMat = new THREE.MeshPhysicalMaterial( {
			map: leafMap,
			normalMap: useNormal ? leafNormal : null,
			normalScale: new THREE.Vector2( 0.85, 0.85 ),
			alphaTest: 0.45,
			side: THREE.FrontSide,
			roughness: 0.54,
			metalness: 0.0,
			sheen: 0.25,
			sheenRoughness: 0.65,
			sheenColor: new THREE.Color( '#9fc96b' ),
			vertexColors: true,
			wireframe,
		} );
		attachWindSway( leafMat, windUniforms, 0.09 );

		const leafGeo = buffersToThreeGeometry( treeData.leaves );
		const leafMesh = new THREE.Mesh( leafGeo, leafMat );
		leafMesh.name = 'leaves';
		leafMesh.castShadow = true;
		leafMesh.receiveShadow = true;
		group.add( leafMesh );

	}

	return group;

}

export function buildFlowerMeshGroup(
	preset: FlowerPresetId,
	seed: number,
	windUniforms: WindUniforms,
	options: { heightMeters?: number; useNormalMap?: boolean; wireframe?: boolean } = {},
): THREE.Group {

	const fl = buildFlowerClump( preset, seed, options.heightMeters ?? 0.48 );
	const wireframe = options.wireframe ?? false;

	const stemMat = new THREE.MeshStandardMaterial( {
		vertexColors: true,
		roughness: 0.56,
		metalness: 0.0,
		side: THREE.DoubleSide,
		wireframe,
	} );
	attachWindSway( stemMat, windUniforms, 0.045 );

	const petalMat = new THREE.MeshPhysicalMaterial( {
		vertexColors: true,
		roughness: preset === 'tulip' ? 0.34 : 0.46,
		metalness: 0.0,
		sheen: 0.55,
		sheenRoughness: 0.48,
		sheenColor: new THREE.Color( preset === 'rose' ? '#ffc8d6' : preset === 'tulip' ? '#ffd9b0' : '#ffffff' ),
		side: THREE.DoubleSide,
		wireframe,
	} );
	attachWindSway( petalMat, windUniforms, 0.045 );

	const centerMat = new THREE.MeshStandardMaterial( {
		vertexColors: true,
		roughness: 0.72,
		metalness: 0.0,
		wireframe,
	} );
	attachWindSway( centerMat, windUniforms, 0.045 );

	const group = new THREE.Group();
	group.name = `flower_${ preset }`;

	const stemMesh = new THREE.Mesh( buffersToThreeGeometry( fl.stemsAndLeaves ), stemMat );
	const petalMesh = new THREE.Mesh( buffersToThreeGeometry( fl.petals ), petalMat );
	const centerMesh = new THREE.Mesh( buffersToThreeGeometry( fl.centerDisc ), centerMat );
	stemMesh.castShadow = true;
	stemMesh.receiveShadow = true;
	petalMesh.castShadow = true;
	petalMesh.receiveShadow = true;
	centerMesh.castShadow = true;

	group.add( stemMesh, petalMesh, centerMesh );
	return group;

}

export function buildGrassFieldGroup(
	preset: GrassPresetId,
	windUniforms: WindUniforms,
	options: { clumpCount?: number; radius?: number; seed?: number; wireframe?: boolean; minRadius?: number } = {},
): THREE.Group {

	const clumpCount = options.clumpCount ?? 45;
	const radius = options.radius ?? 2.2;
	const minRadius = options.minRadius ?? 0.0;
	const seed = options.seed ?? 33;
	const wireframe = options.wireframe ?? false;

	const grassBuf = buildGrassClump( preset, seed, 30 );
	const grassGeo = buffersToThreeGeometry( grassBuf );

	const grassMat = new THREE.MeshPhysicalMaterial( {
		vertexColors: true,
		roughness: 0.52,
		metalness: 0.0,
		sheen: 0.35,
		sheenRoughness: 0.6,
		sheenColor: new THREE.Color( '#b8dc70' ),
		side: THREE.DoubleSide,
		wireframe,
	} );
	attachWindSway( grassMat, windUniforms, 0.065 );

	const inst = new THREE.InstancedMesh( grassGeo, grassMat, clumpCount );
	inst.name = `grass_${ preset }`;
	inst.castShadow = true;
	inst.receiveShadow = true;

	const rng = new Mulberry32( seed + 7 );
	const dummy = new THREE.Object3D();
	for ( let i = 0; i < clumpCount; i ++ ) {

		const ang = rng.range( 0, Math.PI * 2 );
		const dist = minRadius + Math.sqrt( rng.next() ) * Math.max( 0.05, radius - minRadius );
		const sc = rng.range( 0.78, 1.32 );
		dummy.position.set( Math.cos( ang ) * dist, 0, Math.sin( ang ) * dist );
		dummy.rotation.set( rng.signed() * 0.06, rng.range( 0, Math.PI * 2 ), rng.signed() * 0.06 );
		dummy.scale.set( sc, sc * rng.range( 0.85, 1.18 ), sc );
		dummy.updateMatrix();
		inst.setMatrixAt( i, dummy.matrix );

	}
	inst.instanceMatrix.needsUpdate = true;

	const group = new THREE.Group();
	group.add( inst );
	return group;

}

export function buildTerrainAndBoulder( useNormalMap = true, wireframe = false ): {
	ground: THREE.Mesh;
	rock: THREE.Mesh;
} {

	const soilTex = shapedSurfaceToThreeTextures( synthesizeSoilSurface( 256, 77 ), 26 );
	const groundGeo = new THREE.CircleGeometry( 26, 64 );
	groundGeo.rotateX( - Math.PI / 2 );
	const pos = groundGeo.getAttribute( 'position' );
	for ( let i = 0; i < pos.count; i ++ ) {

		const x = pos.getX( i );
		const z = pos.getZ( i );
		const r = Math.hypot( x, z );
		// Gentle natural meadow slope outside immediate center
		const hill = Math.sin( x * 0.22 ) * Math.cos( z * 0.19 ) * 0.35 * Math.min( 1, Math.max( 0, ( r - 2.0 ) / 8.0 ) );
		pos.setY( i, hill );

	}
	groundGeo.computeVertexNormals();

	const groundMat = new THREE.MeshStandardMaterial( {
		map: soilTex.map,
		normalMap: useNormalMap ? soilTex.normalMap : null,
		normalScale: new THREE.Vector2( 0.85, 0.85 ),
		aoMap: soilTex.ormMap,
		roughnessMap: soilTex.ormMap,
		roughness: 0.94,
		metalness: 0.0,
		wireframe,
	} );
	const ground = new THREE.Mesh( groundGeo, groundMat );
	ground.name = 'ground_soil';
	ground.receiveShadow = true;

	const rockBuf = buildWeatheredRock( 512, 0.72, 0.34, 0.42, 2 );
	const rockTex = shapedSurfaceToThreeTextures( granitePresetSurface( 128, 42, 0.36 ), 2 );
	const rockMat = new THREE.MeshStandardMaterial( {
		map: rockTex.map,
		normalMap: useNormalMap ? rockTex.normalMap : null,
		roughnessMap: rockTex.ormMap,
		aoMap: rockTex.ormMap,
		roughness: 0.88,
		vertexColors: true,
		wireframe,
	} );
	const rock = new THREE.Mesh( buffersToThreeGeometry( rockBuf ), rockMat );
	rock.name = 'weathered_boulder';
	rock.position.set( 2.15, 0.10, 1.35 );
	rock.castShadow = true;
	rock.receiveShadow = true;

	return { ground, rock };

}

export interface GardenSceneBuildResult {
	group: THREE.Group;
	plan: GardenLayoutPlan;
	animatedMaps: THREE.Texture[];
	waterStreamUniforms: { uTime: { value: number } };
}

/**
 * Builds the complete Photorealistic Botanical Lake Garden:
 * - Sculpted sunken lake basin + animated Fresnel/normal-rippled water + lily pads + shoreline reeds
 * - Carved 2-tier limestone Fountain with flowing parabolic water arcs
 * - Winding bluestone/slate Flagstone Path (石板路) with strict zero-overlap seams
 * - Multi-tier PBR Scholar's Rockery (假山) with 512px stratified granite/moss PBR maps
 * - 4 Procedural Trees (Oak, Pine, Birch), 37 Flower Clumps, and 1,200+ dense collision-free Grass Tufts
 */
export function buildBotanicalGardenGroup(
	windUniforms: WindUniforms,
	options: {
		showLeaves?: boolean;
		useNormalMap?: boolean;
		wireframe?: boolean;
		gardenTheme?: 'oak' | 'pine' | 'birch';
	} = {},
): GardenSceneBuildResult {

	const showLeaves = options.showLeaves ?? true;
	const useNormal = options.useNormalMap ?? true;
	const wireframe = options.wireframe ?? false;
	const theme = options.gardenTheme ?? 'oak';
	const seedOffset = theme === 'pine' ? 100 : theme === 'birch' ? 200 : 0;

	const plan = planBotanicalGardenLayout( 2026 + seedOffset );
	const group = new THREE.Group();
	group.name = 'photorealistic_botanical_garden';
	const animatedMaps: THREE.Texture[] = [];
	const waterStreamUniforms = { uTime: { value: 0 } };

	// 1. High-resolution sculpted garden terrain (lake basin + path gravel bed + lawn turf + NW rockery berm)
	const soilTex = shapedSurfaceToThreeTextures( synthesizeSoilSurface( 256, 77 ), 28 );
	const groundGeo = new THREE.PlaneGeometry( 54, 54, 150, 150 );
	groundGeo.rotateX( - Math.PI / 2 );
	const gPos = groundGeo.getAttribute( 'position' );
	const gColors = new Float32Array( gPos.count * 3 );

	for ( let i = 0; i < gPos.count; i ++ ) {

		const x = gPos.getX( i );
		const z = gPos.getZ( i );
		const y = sampleGardenTerrainHeight( x, z );
		gPos.setY( i, y );

		const lsd = lakeSignedDistance( x, z );
		const dPath = distanceToPathSpine( x, z );
		let cr = 0.88, cg = 0.98, cb = 0.72; // Lush meadow turf multiplier
		if ( lsd < - 0.25 ) {

			// Deep lake river-pebble & silt bed
			cr = 0.22; cg = 0.28; cb = 0.25;

		} else if ( lsd < 0.30 ) {

			// Wet sandy-pebble littoral shoreline transition
			const t = ( lsd + 0.25 ) / 0.55;
			const shoreR = 0.68, shoreG = 0.60, shoreB = 0.46;
			cr = 0.22 + ( shoreR - 0.22 ) * Math.min( 1, t * 1.6 );
			cg = 0.28 + ( shoreG - 0.28 ) * Math.min( 1, t * 1.6 );
			cb = 0.25 + ( shoreB - 0.25 ) * Math.min( 1, t * 1.6 );
			if ( t > 0.55 ) {

				const m = ( t - 0.55 ) / 0.45;
				cr = cr * ( 1 - m ) + 0.88 * m;
				cg = cg * ( 1 - m ) + 0.98 * m;
				cb = cb * ( 1 - m ) + 0.72 * m;

			}

		} else if ( dPath < 0.48 ) {

			// Compacted warm crushed granite gravel bed under flagstones
			const t = Math.max( 0, Math.min( 1, ( 0.48 - dPath ) / 0.26 ) );
			cr = 0.88 * ( 1 - t ) + 0.74 * t;
			cg = 0.98 * ( 1 - t ) + 0.68 * t;
			cb = 0.72 * ( 1 - t ) + 0.56 * t;

		}
		gColors[ i * 3 ] = cr;
		gColors[ i * 3 + 1 ] = cg;
		gColors[ i * 3 + 2 ] = cb;

	}
	groundGeo.setAttribute( 'color', new THREE.BufferAttribute( gColors, 3 ) );
	groundGeo.computeVertexNormals();

	const groundMat = new THREE.MeshStandardMaterial( {
		map: soilTex.map,
		normalMap: useNormal ? soilTex.normalMap : null,
		normalScale: new THREE.Vector2( 0.90, 0.90 ),
		aoMap: soilTex.ormMap,
		roughnessMap: soilTex.ormMap,
		roughness: 0.92,
		metalness: 0.0,
		vertexColors: true,
		wireframe,
	} );
	const groundMesh = new THREE.Mesh( groundGeo, groundMat );
	groundMesh.name = 'garden_terrain';
	groundMesh.receiveShadow = true;
	group.add( groundMesh );

	// 2. Animated Lake Water Surface (depth-tinted Fresnel reflection + ripple normal map + real shadows!)
	const waterNormBytes = synthesizeWaterNormalMap( 256, 149 );
	const waterNormTex = new THREE.DataTexture( waterNormBytes, 256, 256, THREE.RGBAFormat );
	waterNormTex.colorSpace = THREE.NoColorSpace;
	waterNormTex.wrapS = THREE.RepeatWrapping;
	waterNormTex.wrapT = THREE.RepeatWrapping;
	waterNormTex.repeat.set( 4, 4 );
	waterNormTex.generateMipmaps = true;
	waterNormTex.needsUpdate = true;
	animatedMaps.push( waterNormTex );

	const lakeGeo = new THREE.CircleGeometry( 5.2, 96 );
	lakeGeo.rotateX( - Math.PI / 2 );
	const lPos = lakeGeo.getAttribute( 'position' );
	const lCol = new Float32Array( lPos.count * 4 );
	for ( let i = 0; i < lPos.count; i ++ ) {

		const wx = lPos.getX( i ) + plan.lakeCenter[ 0 ];
		const wz = lPos.getZ( i ) + plan.lakeCenter[ 1 ];
		const lsd = lakeSignedDistance( wx, wz );
		// Keep water slightly tucked beneath bank beyond shoreline so edges meet soil seamlessly
		if ( lsd > 0.15 ) lPos.setY( i, - 0.25 );
		const depth = Math.max( 0, - lsd );
		const dNorm = Math.min( 1, depth / 1.4 );
		// Shallow turquoise-emerald -> deep sapphire-teal lake absorption
		lCol[ i * 4 ] = 0.14 * ( 1 - dNorm ) + 0.03 * dNorm;
		lCol[ i * 4 + 1 ] = 0.34 * ( 1 - dNorm ) + 0.15 * dNorm;
		lCol[ i * 4 + 2 ] = 0.30 * ( 1 - dNorm ) + 0.17 * dNorm;
		lCol[ i * 4 + 3 ] = Math.min( 0.90, 0.36 + 0.54 * Math.pow( dNorm, 0.55 ) );

	}
	lakeGeo.setAttribute( 'color', new THREE.BufferAttribute( lCol, 4 ) );
	lakeGeo.computeVertexNormals();

	const lakeWaterMat = new THREE.MeshPhysicalMaterial( {
		vertexColors: true,
		normalMap: useNormal ? waterNormTex : null,
		normalScale: new THREE.Vector2( 0.42, 0.42 ),
		roughness: 0.06,
		metalness: 0.04,
		clearcoat: 1.0,
		clearcoatRoughness: 0.04,
		reflectivity: 0.95,
		envMapIntensity: 1.75,
		transparent: true,
		wireframe,
	} );
	const lakeWater = new THREE.Mesh( lakeGeo, lakeWaterMat );
	lakeWater.name = 'lake_water';
	lakeWater.position.set( plan.lakeCenter[ 0 ], WATER_LEVEL, plan.lakeCenter[ 1 ] );
	lakeWater.receiveShadow = true;
	group.add( lakeWater );

	// 3. Carved Limestone Tiered Fountain + Flowing Animated Water Jets (喷泉)
	const limestoneTex = shapedSurfaceToThreeTextures( synthesizeCarvedLimestoneSurface( 256, 61 ), 2 );
	const fountainData = buildStoneFountainGeometry( 44 );
	const fountainMat = new THREE.MeshStandardMaterial( {
		map: limestoneTex.map,
		normalMap: useNormal ? limestoneTex.normalMap : null,
		normalScale: new THREE.Vector2( 1.0, 1.0 ),
		aoMap: limestoneTex.ormMap,
		roughnessMap: limestoneTex.ormMap,
		roughness: 0.72,
		metalness: 0.0,
		vertexColors: true,
		wireframe,
	} );
	const fountainGroup = new THREE.Group();
	fountainGroup.name = 'fountain';
	fountainGroup.position.set( plan.fountainPos[ 0 ], 0, plan.fountainPos[ 2 ] );

	const fountainStone = new THREE.Mesh( buffersToThreeGeometry( fountainData.stone ), fountainMat );
	fountainStone.castShadow = true;
	fountainStone.receiveShadow = true;
	fountainGroup.add( fountainStone );

	// Lower & upper fountain pool water discs
	const poolWaterMat = new THREE.MeshPhysicalMaterial( {
		color: new THREE.Color( '#2c7e82' ),
		normalMap: useNormal ? waterNormTex : null,
		normalScale: new THREE.Vector2( 0.55, 0.55 ),
		roughness: 0.05,
		metalness: 0.05,
		clearcoat: 1.0,
		transparent: true,
		opacity: 0.84,
		envMapIntensity: 1.6,
		wireframe,
	} );
	const lowerDisc = new THREE.Mesh( new THREE.CircleGeometry( 0.75, 36 ).rotateX( - Math.PI / 2 ), poolWaterMat );
	lowerDisc.position.y = fountainData.lowerPoolWaterY;
	lowerDisc.receiveShadow = true;
	const upperDisc = new THREE.Mesh( new THREE.CircleGeometry( 0.39, 32 ).rotateX( - Math.PI / 2 ), poolWaterMat );
	upperDisc.position.y = fountainData.upperPoolWaterY;
	upperDisc.receiveShadow = true;
	fountainGroup.add( lowerDisc, upperDisc );

	// Animated flowing parabolic fountain water streams
	const streamBuf = buildFountainWaterStreamsGeometry(
		fountainData.lowerPoolWaterY,
		fountainData.upperPoolWaterY,
		fountainData.nozzleTipY,
	);
	const streamMat = new THREE.MeshPhysicalMaterial( {
		vertexColors: true,
		color: new THREE.Color( '#e3f6ff' ),
		roughness: 0.08,
		metalness: 0.0,
		clearcoat: 1.0,
		transparent: true,
		opacity: 0.78,
		envMapIntensity: 1.5,
		wireframe,
	} );
	streamMat.onBeforeCompile = ( shader ) => {

		shader.uniforms.uStreamTime = waterStreamUniforms.uTime;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
				varying vec2 vStreamUv;`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vStreamUv = uv;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				varying vec2 vStreamUv;
				uniform float uStreamTime;`,
			)
			.replace(
				'#include <dithering_fragment>',
				`float foamPulse = 0.72 + 0.28 * sin(vStreamUv.y * 28.0 - uStreamTime * 11.0);
				gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.94, 0.99, 1.0), 0.38 * foamPulse);
				#include <dithering_fragment>`,
			);

	};
	const streamMesh = new THREE.Mesh( buffersToThreeGeometry( streamBuf ), streamMat );
	streamMesh.name = 'fountain_water_jets';
	fountainGroup.add( streamMesh );
	group.add( fountainGroup );

	// 4. Winding Bluestone/Slate Flagstone Path (石板路)
	const slateTex = shapedSurfaceToThreeTextures( synthesizeFlagstoneSlateSurface( 256, 83 ), 1.4 );
	const slateMat = new THREE.MeshStandardMaterial( {
		map: slateTex.map,
		normalMap: useNormal ? slateTex.normalMap : null,
		normalScale: new THREE.Vector2( 1.15, 1.15 ),
		aoMap: slateTex.ormMap,
		roughnessMap: slateTex.ormMap,
		roughness: 0.76,
		metalness: 0.0,
		vertexColors: true,
		wireframe,
	} );
	const pathGroup = new THREE.Group();
	pathGroup.name = 'flagstone_path';
	for ( const slab of plan.flagstones ) {

		const slabGeo = buffersToThreeGeometry( buildFlagstoneSlabGeometry( slab.radius, 0.068, slab.seed ) );
		const slabMesh = new THREE.Mesh( slabGeo, slateMat );
		slabMesh.name = slab.id;
		slabMesh.position.set( slab.cx, slab.y + 0.008, slab.cz );
		slabMesh.rotation.set( slab.tiltX, slab.yaw, slab.tiltZ );
		slabMesh.castShadow = true;
		slabMesh.receiveShadow = true;
		pathGroup.add( slabMesh );

	}
	group.add( pathGroup );

	// 5. Layered PBR Scholar's Rockery (假山 — 512x512 Surface::shaped Granite + Moss PBR)
	const scholarTex = shapedSurfaceToThreeTextures( synthesizeScholarRockSurface( 512, 109 ), 2 );
	const rockeryMat = new THREE.MeshStandardMaterial( {
		map: scholarTex.map,
		normalMap: useNormal ? scholarTex.normalMap : null,
		normalScale: new THREE.Vector2( 1.35, 1.35 ),
		aoMap: scholarTex.ormMap,
		roughnessMap: scholarTex.ormMap,
		roughness: 0.85,
		metalness: 0.02,
		vertexColors: true,
		wireframe,
	} );
	const rockeryGroup = new THREE.Group();
	rockeryGroup.name = 'scholar_rockery';
	for ( const st of plan.rockeryStones ) {

		const rockGeo = buffersToThreeGeometry( buildScholarRockMesh( st ) );
		const rockMesh = new THREE.Mesh( rockGeo, rockeryMat );
		rockMesh.name = st.id;
		rockMesh.position.set( st.x, st.y, st.z );
		rockMesh.rotation.y = st.yaw;
		rockMesh.castShadow = true;
		rockMesh.receiveShadow = true;
		rockeryGroup.add( rockMesh );

	}
	for ( const sb of plan.shoreBoulders ) {

		const rockGeo = buffersToThreeGeometry( buildScholarRockMesh( sb ) );
		const rockMesh = new THREE.Mesh( rockGeo, rockeryMat );
		rockMesh.name = sb.id;
		rockMesh.position.set( sb.x, sb.y, sb.z );
		rockMesh.rotation.y = sb.yaw;
		rockMesh.castShadow = true;
		rockMesh.receiveShadow = true;
		rockeryGroup.add( rockMesh );

	}
	group.add( rockeryGroup );

	// 6. Floating Water Lilies + Low-Profile Floating Lotus Blooms & Shallow Shoreline Reeds
	const lilyGeo = new THREE.CircleGeometry( 1, 20, 0.16, Math.PI * 1.90 );
	lilyGeo.rotateX( - Math.PI / 2 );
	const lilyMat = new THREE.MeshStandardMaterial( {
		color: new THREE.Color( '#3b7d35' ),
		roughness: 0.36,
		metalness: 0.0,
		side: THREE.DoubleSide,
		wireframe,
	} );
	const lilyInst = new THREE.InstancedMesh( lilyGeo, lilyMat, Math.max( 1, plan.lilyPads.length ) );
	lilyInst.name = 'lake_lily_pads';
	lilyInst.receiveShadow = true;
	const dummy = new THREE.Object3D();

	// Low-profile floating water-lily cup bloom (no tall terrestrial stem sticking above water!)
	const lotusFl = buildFlowerClump( 'rose', 888, 0.02 );
	const lotusPetalMat = new THREE.MeshPhysicalMaterial( {
		vertexColors: true,
		roughness: 0.36,
		sheen: 0.55,
		sheenColor: new THREE.Color( '#ffdce8' ),
		side: THREE.DoubleSide,
		wireframe,
	} );
	const lotusCenterMat = new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.68, wireframe } );
	const lotusPetalGeo = buffersToThreeGeometry( lotusFl.petals );
	const lotusCenterGeo = buffersToThreeGeometry( lotusFl.centerDisc );

	for ( let i = 0; i < plan.lilyPads.length; i ++ ) {

		const lp = plan.lilyPads[ i ]!;
		dummy.position.set( lp.x, WATER_LEVEL + 0.008, lp.z );
		dummy.rotation.set( 0, lp.yaw, 0 );
		dummy.scale.set( lp.radius, 1, lp.radius );
		dummy.updateMatrix();
		lilyInst.setMatrixAt( i, dummy.matrix );

		if ( lp.hasBloom ) {

			const bloomGrp = new THREE.Group();
			bloomGrp.position.set( lp.x, WATER_LEVEL - 0.004, lp.z );
			bloomGrp.rotation.y = lp.yaw;
			bloomGrp.scale.set( 0.85, 0.72, 0.85 );
			const pMesh = new THREE.Mesh( lotusPetalGeo, lotusPetalMat );
			const cMesh = new THREE.Mesh( lotusCenterGeo, lotusCenterMat );
			pMesh.castShadow = true;
			bloomGrp.add( pMesh, cMesh );
			group.add( bloomGrp );

		}

	}
	lilyInst.instanceMatrix.needsUpdate = true;
	group.add( lilyInst );

	// Shoreline Aquatic Sedge Reeds
	const reedGeo = buffersToThreeGeometry( buildGrassClump( 'sedge', 311, 22 ) );
	const reedMat = new THREE.MeshPhysicalMaterial( {
		vertexColors: true,
		roughness: 0.48,
		sheen: 0.35,
		sheenColor: new THREE.Color( '#a6d468' ),
		side: THREE.DoubleSide,
		wireframe,
	} );
	attachWindSway( reedMat, windUniforms, 0.075 );
	const reedInst = new THREE.InstancedMesh( reedGeo, reedMat, Math.max( 1, plan.reeds.length ) );
	reedInst.name = 'shoreline_reeds';
	reedInst.castShadow = true;
	reedInst.receiveShadow = true;
	for ( let i = 0; i < plan.reeds.length; i ++ ) {

		const rd = plan.reeds[ i ]!;
		dummy.position.set( rd.x, rd.y, rd.z );
		dummy.rotation.set( 0, rd.yaw, 0 );
		dummy.scale.setScalar( rd.scale );
		dummy.updateMatrix();
		reedInst.setMatrixAt( i, dummy.matrix );

	}
	reedInst.instanceMatrix.needsUpdate = true;
	group.add( reedInst );

	// 7. Procedural Trees placed cleanly outside lake, path & rockery
	for ( const tr of plan.trees ) {

		const tree = buildTreeMeshGroup( tr.preset, tr.seed + seedOffset, windUniforms, {
			showLeaves,
			useNormalMap: useNormal,
			wireframe,
			heightScale: tr.heightScale,
		} );
		tree.position.set( tr.x, tr.y, tr.z );
		group.add( tree );

	}

	// 8. Curated Flower Beds along Flagstone Path & Rockery Apron
	for ( const fl of plan.flowers ) {

		const flower = buildFlowerMeshGroup( fl.preset, fl.seed + seedOffset, windUniforms, {
			heightMeters: fl.heightMeters,
			useNormalMap: useNormal,
			wireframe,
		} );
		flower.position.set( fl.x, fl.y, fl.z );
		flower.rotation.y = fl.seed * 0.65;
		group.add( flower );

	}

	// 9. Dense Collision-Free Instanced Lawn & Meadow Grass (Fescue, Foxtail, Sedge)
	const grassGroups: Record<GrassPresetId, typeof plan.grassClumps> = {
		fescue: [],
		foxtail: [],
		sedge: [],
	};
	for ( const gr of plan.grassClumps ) grassGroups[ gr.preset ].push( gr );

	for ( const preset of [ 'fescue', 'foxtail', 'sedge' ] as const ) {

		const list = grassGroups[ preset ];
		if ( list.length === 0 ) continue;
		const geo = buffersToThreeGeometry( buildGrassClump( preset, 71 + preset.length * 13, 30 ) );
		const mat = new THREE.MeshPhysicalMaterial( {
			vertexColors: true,
			roughness: 0.50,
			metalness: 0.0,
			sheen: 0.35,
			sheenRoughness: 0.58,
			sheenColor: new THREE.Color( '#b8dc70' ),
			side: THREE.DoubleSide,
			wireframe,
		} );
		attachWindSway( mat, windUniforms, 0.065 );
		const inst = new THREE.InstancedMesh( geo, mat, list.length );
		inst.name = `garden_grass_${ preset }`;
		inst.castShadow = true;
		inst.receiveShadow = true;
		const tint = new THREE.Color();
		const tintRng = new Mulberry32( 401 + preset.length * 19 );
		for ( let i = 0; i < list.length; i ++ ) {

			const g = list[ i ]!;
			dummy.position.set( g.x, g.y, g.z );
			dummy.rotation.set( 0, g.yaw, 0 );
			dummy.scale.set( g.scale, g.scale * 0.92, g.scale );
			dummy.updateMatrix();
			inst.setMatrixAt( i, dummy.matrix );
			// Natural chlorophyll hue & brightness variation per clump
			tint.setRGB( tintRng.range( 0.84, 1.12 ), tintRng.range( 0.88, 1.10 ), tintRng.range( 0.78, 1.05 ) );
			inst.setColorAt( i, tint );

		}
		inst.instanceMatrix.needsUpdate = true;
		if ( inst.instanceColor ) inst.instanceColor.needsUpdate = true;
		group.add( inst );

	}

	return { group, plan, animatedMaps, waterStreamUniforms };

}
