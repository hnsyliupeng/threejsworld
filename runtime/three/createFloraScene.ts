/**
 * Three.js Photorealistic Botanical Lake Garden & Procedural Sky/IBL Environment
 * Fuses Preetham Sky + Volumetric Clouds + PMREM HDR IBL,
 * Planar-Reflective Flowing Water (`Water.js` + concentric fountain ripples, splash foam & shallow-shore clarity),
 * Submerged Pebble Caustics, 512px Surface::shaped PBR, Coverage-Preserving Alpha Mipmaps,
 * Backlit Foliage SSS, Stratified Karst Rockery, Woodland Ferns, and 50,000+ Wind-Swaying Meadow Blades.
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import {
	FOUNTAIN_CENTER,
	Mulberry32,
	WATER_LEVEL,
	buildFernRosette,
	buildFlagstoneSlabGeometry,
	buildFlowerClump,
	buildFountainWaterStreamsGeometry,
	buildGrassClump,
	buildMeadowTuft,
	buildScholarRockMesh,
	buildStoneFountainGeometry,
	buildWeatheredRock,
	buildWoodlandShrub,
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
	synthesizePebbleBedSurface,
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

export const GOLDEN_SUN_DIR = new THREE.Vector3( 0.74, 0.34, - 0.58 ).normalize();

export function attachWindSway(
	material: THREE.Material,
	uniforms: WindUniforms,
	swayAmp = 0.08,
	options: { subsurface?: boolean; sunDir?: THREE.Vector3 } = {},
): void {

	const prevKey = material.customProgramCacheKey?.() ?? '';
	const hasSSS = options.subsurface ?? false;
	const sunDir = options.sunDir ?? GOLDEN_SUN_DIR;

	material.onBeforeCompile = ( shader ) => {

		shader.uniforms.uTime = uniforms.uTime;
		shader.uniforms.uWindStrength = uniforms.uWindStrength;
		if ( hasSSS ) shader.uniforms.uSunDir = { value: sunDir };

		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
				attribute float aWind;
				uniform float uTime;
				uniform float uWindStrength;
				${ hasSSS ? 'varying vec3 vSssWorldPos;' : '' }`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				#ifdef USE_INSTANCING
					vec4 wpRef = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
					float phase = wpRef.x * 1.15 + wpRef.z * 0.95;
				#else
					vec4 wpRef = modelMatrix * vec4(position, 1.0);
					float phase = wpRef.x * 0.9 + wpRef.z * 0.8;
				#endif
				float gustWave = sin(uTime * 1.9 + phase) * 0.65 + sin(uTime * 3.8 + phase * 1.85) * 0.35;
				float bend = pow(clamp(aWind, 0.0, 1.0), 1.55) * uWindStrength * ${ swayAmp.toFixed( 4 ) };
				transformed.x += gustWave * bend;
				transformed.z += cos(uTime * 1.35 + phase * 0.8) * bend * 0.45;`,
			);

		if ( hasSSS ) {

			shader.vertexShader = shader.vertexShader.replace(
				'#include <worldpos_vertex>',
				`#include <worldpos_vertex>
				vSssWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
				#ifdef USE_INSTANCING
					vSssWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
				#endif`,
			);
			shader.fragmentShader = shader.fragmentShader
				.replace(
					'#include <common>',
					`#include <common>
					uniform vec3 uSunDir;
					varying vec3 vSssWorldPos;`,
				)
				.replace(
					'#include <dithering_fragment>',
					`vec3 viewToCam = normalize(cameraPosition - vSssWorldPos);
					float backScatter = pow(clamp(dot(-viewToCam, normalize(uSunDir)), 0.0, 1.0), 3.4);
					float rimGlow = pow(1.0 - abs(dot(normal, viewToCam)), 2.8) * 0.22;
					gl_FragColor.rgb += diffuseColor.rgb * vec3(1.18, 0.90, 0.26) * (backScatter * 0.16 + rimGlow * 0.04);
					#include <dithering_fragment>`,
				);

		}

	};
	material.customProgramCacheKey = () => `${ prevKey }-wind-${ swayAmp }-sss-${ hasSSS }`;

}

/**
 * Physical Preetham Atmospheric Sky + Volumetric Golden-Hour Clouds + PMREM HDR IBL.
 */
export function buildProceduralSkyDomeAndPMREM( renderer: THREE.WebGLRenderer ): {
	skyDome: Sky;
	envMap: THREE.Texture;
} {

	const sky = new Sky();
	sky.scale.setScalar( 4500 );

	const skyUniforms = sky.material.uniforms;
	skyUniforms[ 'turbidity' ]!.value = 8.8;
	skyUniforms[ 'rayleigh' ]!.value = 2.25;
	skyUniforms[ 'mieCoefficient' ]!.value = 0.0042;
	skyUniforms[ 'mieDirectionalG' ]!.value = 0.76;
	skyUniforms[ 'cloudScale' ]!.value = 0.00022;
	skyUniforms[ 'cloudSpeed' ]!.value = 0.000018;
	skyUniforms[ 'cloudCoverage' ]!.value = 0.62;
	skyUniforms[ 'cloudDensity' ]!.value = 0.74;
	skyUniforms[ 'cloudElevation' ]!.value = 0.56;
	skyUniforms[ 'sunPosition' ]!.value.copy( GOLDEN_SUN_DIR ).multiplyScalar( 10000 );

	// Calibrate Sky HDR radiance so warm golden clouds & creamy-apricot horizon show richly instead of clipping #FFFFFF
	const skyMat = sky.material as THREE.ShaderMaterial;
	skyMat.fragmentShader = skyMat.fragmentShader.replace(
		'gl_FragColor = vec4( texColor, 1.0 );',
		'gl_FragColor = vec4( texColor * vec3(0.185, 0.145, 0.102), 1.0 );',
	);
	skyMat.needsUpdate = true;

	// Hide blazing sun disc during PMREM bake so specular IBL stays crisp without ring artifacts
	skyUniforms[ 'showSunDisc' ]!.value = 0;
	const pmremScene = new THREE.Scene();
	pmremScene.add( sky );
	const pmremGen = new THREE.PMREMGenerator( renderer );
	pmremGen.compileEquirectangularShader();
	const envRT = pmremGen.fromScene( pmremScene, 0.04 );
	pmremGen.dispose();

	skyUniforms[ 'showSunDisc' ]!.value = 1;
	pmremScene.remove( sky );

	return { skyDome: sky, envMap: envRT.texture };

}

export function buildTreeMeshGroup(
	preset: TreePresetId,
	seed: number,
	windUniforms: WindUniforms,
	options: { showLeaves?: boolean; useNormalMap?: boolean; wireframe?: boolean; heightScale?: number; atlasSize?: number; lod?: 'hero' | 'horizon'; castShadow?: boolean } = {},
): THREE.Group {

	const showLeaves = options.showLeaves ?? true;
	const useNormal = options.useNormalMap ?? true;
	const wireframe = options.wireframe ?? false;
	const atlasSize = options.atlasSize ?? 512;
	const castShadow = options.castShadow ?? true;

	const treeData = generateRealisticTree( { preset, seed, heightScale: options.heightScale ?? 1.0, lod: options.lod ?? 'hero' } );
	const barkTex = shapedSurfaceToThreeTextures( synthesizeBarkSurface( preset, atlasSize >= 512 ? 512 : 256, seed ), 2 );

	const barkMat = new THREE.MeshStandardMaterial( {
		map: barkTex.map,
		normalMap: useNormal ? barkTex.normalMap : null,
		normalScale: new THREE.Vector2( 1.25, 1.25 ),
		aoMap: barkTex.ormMap,
		roughnessMap: barkTex.ormMap,
		roughness: 0.94,
		metalness: 0.0,
		envMapIntensity: 0.55,
		vertexColors: true,
		wireframe,
	} );

	const group = new THREE.Group();
	group.name = `tree_${ preset }`;

	const barkGeo = buffersToThreeGeometry( treeData.bark );
	const barkMesh = new THREE.Mesh( barkGeo, barkMat );
	barkMesh.name = 'bark';
	barkMesh.castShadow = castShadow;
	barkMesh.receiveShadow = true;
	group.add( barkMesh );

	if ( showLeaves ) {

		const atlas = synthesizeLeafSprigAtlas( preset, atlasSize, 0.42 );
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

		const leafMat = new THREE.MeshStandardMaterial( {
			map: leafMap,
			normalMap: useNormal ? leafNormal : null,
			normalScale: new THREE.Vector2( 0.85, 0.85 ),
			alphaTest: 0.42,
			side: THREE.FrontSide,
			roughness: 0.74,
			metalness: 0.0,
			envMapIntensity: 0.14,
			vertexColors: true,
			wireframe,
		} );
		attachWindSway( leafMat, windUniforms, 0.080, { subsurface: true } );

		const leafGeo = buffersToThreeGeometry( treeData.leaves );
		const leafMesh = new THREE.Mesh( leafGeo, leafMat );
		leafMesh.name = 'leaves';
		leafMesh.castShadow = castShadow;
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
	attachWindSway( petalMat, windUniforms, 0.045, { subsurface: true } );

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
	attachWindSway( grassMat, windUniforms, 0.065, { subsurface: true } );

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

	const soilTex = shapedSurfaceToThreeTextures( synthesizeSoilSurface( 512, 77 ), 26 );
	const groundGeo = new THREE.CircleGeometry( 26, 64 );
	groundGeo.rotateX( - Math.PI / 2 );
	const pos = groundGeo.getAttribute( 'position' );
	for ( let i = 0; i < pos.count; i ++ ) {

		const x = pos.getX( i );
		const z = pos.getZ( i );
		const r = Math.hypot( x, z );
		const hill = Math.sin( x * 0.22 ) * Math.cos( z * 0.19 ) * 0.35 * Math.min( 1, Math.max( 0, ( r - 2.0 ) / 8.0 ) );
		pos.setY( i, hill );

	}
	groundGeo.computeVertexNormals();

	const groundMat = new THREE.MeshStandardMaterial( {
		map: soilTex.map,
		normalMap: useNormalMap ? soilTex.normalMap : null,
		normalScale: new THREE.Vector2( 0.90, 0.90 ),
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
	lakeWater: Water;
	updateWaterTime: ( tSec: number ) => void;
}

/**
 * Generates an RGBA DataTexture encoding water depth (`r`: normalized 0..1 depth, `g`: wet shoreline band)
 * across a 10m x 10m domain centered on LAKE_CENTER so Water.js & Terrain caustics align seamlessly.
 */
function buildLakeDepthMap( lakeCenter: [ number, number ], domainHalfSize = 5.0, texSize = 256 ): THREE.DataTexture {

	const data = new Uint8Array( texSize * texSize * 4 );
	for ( let y = 0; y < texSize; y ++ ) {

		const wz = lakeCenter[ 1 ] + ( ( y / ( texSize - 1 ) ) * 2 - 1 ) * domainHalfSize;
		for ( let x = 0; x < texSize; x ++ ) {

			const wx = lakeCenter[ 0 ] + ( ( x / ( texSize - 1 ) ) * 2 - 1 ) * domainHalfSize;
			const lsd = lakeSignedDistance( wx, wz );
			const h = sampleGardenTerrainHeight( wx, wz );
			const depth = Math.max( 0, WATER_LEVEL - h );
			const insideWater = lsd < 0.02 ? 1.0 : Math.max( 0, 1.0 - ( lsd - 0.02 ) / 0.12 );
			const dNorm = Math.min( 1, ( depth / 0.72 ) * insideWater );
			const wetShore = Math.max( 0, Math.min( 1, 1.0 - Math.max( 0, lsd ) / 0.34 ) );
			const p4 = ( y * texSize + x ) * 4;
			data[ p4 ] = Math.round( dNorm * 255 );
			data[ p4 + 1 ] = Math.round( wetShore * 255 );
			data[ p4 + 2 ] = Math.round( insideWater * 255 );
			data[ p4 + 3 ] = 255;

		}

	}
	const tex = new THREE.DataTexture( data, texSize, texSize, THREE.RGBAFormat );
	tex.colorSpace = THREE.NoColorSpace;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.needsUpdate = true;
	return tex;

}

/**
 * Builds the complete Photorealistic Botanical Lake Garden:
 * - Sculpted lake basin + sunlit river-pebble bed + animated underwater caustics + wet shoreline rim
 * - Real Planar-Reflective Flowing Water (`Water.js`) with continuous currents, expanding concentric fountain ripples, splash foam & shallow clarity
 * - Carved gadrooned 2-tier limestone Fountain with turbulent streaming curtains, churning bowl foam & animated spray droplets
 * - Winding split-slate Flagstone Path (石板路) with strict zero-overlap seams
 * - Sharp stratified Karst Limestone Rockery (假山) with 512px PBR + nestled woodland ferns
 * - Courtyard & 36 Horizon Woodland Trees (`512px` multi-leaf atlases + backlit SSS), 37 Flower Clumps, and ~51,000 Wind-Swaying Meadow Blades
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
	const lakeDomainHalf = 5.0;
	const lakeDepthTex = buildLakeDepthMap( plan.lakeCenter, lakeDomainHalf, 256 );

	// 1. Sculpted Garden Terrain + Submerged Sunlit Pebble Lakebed + Animated Caustics + Wet Shore Sheen
	const soilTex = shapedSurfaceToThreeTextures( synthesizeSoilSurface( 512, 77 ), 26 );
	const pebbleTex = shapedSurfaceToThreeTextures( synthesizePebbleBedSurface( 512, 211 ), 20 );

	const groundGeo = new THREE.PlaneGeometry( 64, 64, 176, 176 );
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
		let cr = 0.68, cg = 0.94, cb = 0.42;
		if ( lsd < 0.05 ) {

			// Submerged & shoreline bed stays slightly warmer/natural for pebble contrast under water
			cr = 0.72; cg = 0.66; cb = 0.54;

		} else if ( lsd < 0.35 ) {

			const t = ( lsd - 0.05 ) / 0.30;
			cr = 0.56 * ( 1 - t ) + 0.68 * t;
			cg = 0.52 * ( 1 - t ) + 0.94 * t;
			cb = 0.42 * ( 1 - t ) + 0.42 * t;

		} else if ( dPath < 0.24 ) {

			const t = Math.max( 0, Math.min( 1, ( 0.24 - dPath ) / 0.16 ) );
			cr = 0.68 * ( 1 - t ) + 0.64 * t;
			cg = 0.94 * ( 1 - t ) + 0.62 * t;
			cb = 0.42 * ( 1 - t ) + 0.44 * t;

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
		normalScale: new THREE.Vector2( 0.95, 0.95 ),
		aoMap: soilTex.ormMap,
		roughnessMap: soilTex.ormMap,
		roughness: 0.92,
		metalness: 0.0,
		vertexColors: true,
		wireframe,
	} );
	groundMat.onBeforeCompile = ( shader ) => {

		shader.uniforms.uPebbleMap = { value: pebbleTex.map };
		shader.uniforms.uLakeDepthTex = { value: lakeDepthTex };
		shader.uniforms.uLakeBounds = {
			value: new THREE.Vector4(
				plan.lakeCenter[ 0 ] - lakeDomainHalf,
				plan.lakeCenter[ 1 ] - lakeDomainHalf,
				0.5 / lakeDomainHalf,
				0.5 / lakeDomainHalf,
			),
		};
		shader.uniforms.uStreamTime = waterStreamUniforms.uTime;
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nvarying vec3 vTerrainWorldPos;' )
			.replace( '#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;' );
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				uniform sampler2D uPebbleMap;
				uniform sampler2D uLakeDepthTex;
				uniform vec4 uLakeBounds;
				uniform float uStreamTime;
				varying vec3 vTerrainWorldPos;`,
			)
			.replace(
				'#include <map_fragment>',
				`#include <map_fragment>
				vec2 lUv = (vTerrainWorldPos.xz - uLakeBounds.xy) * uLakeBounds.zw;
				if (lUv.x >= 0.0 && lUv.x <= 1.0 && lUv.y >= 0.0 && lUv.y <= 1.0) {
					vec4 dSamp = texture2D(uLakeDepthTex, lUv);
					float wet = dSamp.g;
					float inWater = dSamp.b;
					if (wet > 0.01) {
						vec3 peb = texture2D(uPebbleMap, vTerrainWorldPos.xz * 0.58).rgb;
						diffuseColor.rgb = mix(diffuseColor.rgb, peb * mix(1.0, 0.64, wet), clamp(wet * 0.92, 0.0, 1.0));
						if (inWater > 0.1) {
							float c1 = sin(vTerrainWorldPos.x * 11.0 + uStreamTime * 2.2 + sin(vTerrainWorldPos.z * 8.5 - uStreamTime * 1.7));
							float c2 = cos(vTerrainWorldPos.z * 12.0 - uStreamTime * 2.4 + cos(vTerrainWorldPos.x * 9.0 + uStreamTime * 1.9));
							float caustic = pow(clamp((c1 * c2) * 0.5 + 0.5, 0.0, 1.0), 4.0) * 0.42 * inWater * (1.0 - dSamp.r * 0.65);
							diffuseColor.rgb += vec3(0.45, 0.40, 0.24) * caustic;
						}
					}
				}`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
				vec2 lUvR = (vTerrainWorldPos.xz - uLakeBounds.xy) * uLakeBounds.zw;
				if (lUvR.x >= 0.0 && lUvR.x <= 1.0 && lUvR.y >= 0.0 && lUvR.y <= 1.0) {
					float wetR = texture2D(uLakeDepthTex, lUvR).g;
					roughnessFactor = mix(roughnessFactor, 0.16, wetR * 0.85);
				}`,
			);

	};
	const groundMesh = new THREE.Mesh( groundGeo, groundMat );
	groundMesh.name = 'garden_terrain';
	groundMesh.receiveShadow = true;
	group.add( groundMesh );

	// 2. REAL Planar-Reflective Flowing Water (`Water.js`) + Concentric Fountain Ripples, Splash Foam & Shallow Shore Clarity
	const waterNormBytes = synthesizeWaterNormalMap( 512, 149 );
	const waterNormTex = new THREE.DataTexture( waterNormBytes, 512, 512, THREE.RGBAFormat );
	waterNormTex.colorSpace = THREE.NoColorSpace;
	waterNormTex.wrapS = THREE.RepeatWrapping;
	waterNormTex.wrapT = THREE.RepeatWrapping;
	waterNormTex.generateMipmaps = true;
	waterNormTex.needsUpdate = true;
	animatedMaps.push( waterNormTex );

	const lakeWaterGeo = new THREE.PlaneGeometry( lakeDomainHalf * 2.0, lakeDomainHalf * 2.0 );
	const lakeWater = new Water( lakeWaterGeo, {
		textureWidth: 512,
		textureHeight: 512,
		waterNormals: waterNormTex,
		sunDirection: GOLDEN_SUN_DIR.clone(),
		sunColor: 0xffd592,
		waterColor: 0x0d1c14,
		distortionScale: 1.15,
		alpha: 1.0,
		fog: true,
	} );
	lakeWater.name = 'lake_water';
	lakeWater.rotation.x = - Math.PI / 2;
	lakeWater.position.set( plan.lakeCenter[ 0 ], WATER_LEVEL, plan.lakeCenter[ 1 ] );
	lakeWater.receiveShadow = true;

	// Inject flowing directional current, expanding concentric fountain waves, splash foam & pixel-accurate shallow clarity!
	const waterMat = lakeWater.material as THREE.ShaderMaterial;
	waterMat.transparent = true;
	waterMat.uniforms[ 'size' ]!.value = 2.6;
	waterMat.uniforms[ 'uLakeDepthTex' ] = { value: lakeDepthTex };
	waterMat.uniforms[ 'uLakeBounds' ] = {
		value: new THREE.Vector4(
			plan.lakeCenter[ 0 ] - lakeDomainHalf,
			plan.lakeCenter[ 1 ] - lakeDomainHalf,
			0.5 / lakeDomainHalf,
			0.5 / lakeDomainHalf,
		),
	};
	waterMat.uniforms[ 'uFountainXZ' ] = { value: new THREE.Vector2( FOUNTAIN_CENTER[ 0 ], FOUNTAIN_CENTER[ 1 ] ) };
	waterMat.uniforms[ 'uWireframe' ] = { value: wireframe ? 1 : 0 };
	if ( wireframe ) waterMat.wireframe = true;

	waterMat.fragmentShader = waterMat.fragmentShader
		.replace(
			'uniform vec3 waterColor;',
			`uniform vec3 waterColor;
			uniform sampler2D uLakeDepthTex;
			uniform vec4 uLakeBounds;
			uniform vec2 uFountainXZ;`,
		)
		.replace(
			`vec4 getNoise( vec2 uv ) {
					vec2 uv0 = ( uv / 103.0 ) + vec2(time / 17.0, time / 29.0);
					vec2 uv1 = uv / 107.0-vec2( time / -19.0, time / 31.0 );
					vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );
					vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );
					vec4 noise = texture2D( normalSampler, uv0 ) +
						texture2D( normalSampler, uv1 ) +
						texture2D( normalSampler, uv2 ) +
						texture2D( normalSampler, uv3 );
					return noise * 0.5 - 1.0;
				}`,
			`vec4 getNoise( vec2 uv ) {
					// True flowing currents across pond + fine capillary wind ripples
					vec2 flow1 = vec2( time * 0.085, time * 0.042 );
					vec2 flow2 = vec2( -time * 0.055, time * 0.072 );
					vec2 uv0 = uv * 0.14 + flow1;
					vec2 uv1 = uv * 0.22 + flow2;
					vec2 uv2 = uv * 0.42 + vec2( time * 0.12, -time * 0.09 );
					vec2 uv3 = uv * 0.07 - flow1 * 0.5;
					vec4 noise = texture2D( normalSampler, uv0 ) * 0.34 +
						texture2D( normalSampler, uv1 ) * 0.28 +
						texture2D( normalSampler, uv2 ) * 0.20 +
						texture2D( normalSampler, uv3 ) * 0.18;
					return noise * 2.0 - 1.0;
				}`,
		)
		.replace(
			'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
			`vec2 lakeUv = (worldPosition.xz - uLakeBounds.xy) * uLakeBounds.zw;
			vec4 lakeSamp = texture2D(uLakeDepthTex, clamp(lakeUv, 0.0, 1.0));
			float waterDepth = lakeSamp.r;
			float insideShore = lakeSamp.b;
			if (insideShore < 0.08) discard;

			// Expanding concentric fountain ripples radiating outward from plunge ring!
			vec2 toFnt = worldPosition.xz - uFountainXZ;
			float fDist = length(toFnt);
			float fAng = atan(toFnt.y, toFnt.x);
			vec2 radDir = fDist > 0.001 ? toFnt / fDist : vec2(1.0, 0.0);
			float ringAtten = exp(-max(0.0, fDist - 0.88) * 0.44) * smoothstep(0.70, 0.96, fDist);
			float waveA = cos(fDist * 20.0 - time * 5.6);
			float waveB = cos(fDist * 33.0 - time * 8.2) * 0.42;
			float dRing = (waveA + waveB) * ringAtten * 0.165;
			vec3 baseN = vec3(noise.x * 0.92 + radDir.x * dRing, 1.0, noise.y * 0.92 + radDir.y * dRing);
			vec3 surfaceNormal = normalize(baseN);`,
		)
		.replace(
			'vec3 outgoingLight = albedo;',
			`// Delicate broken lacy froth strictly around the 20 spillover impact points (NO solid white donut!)
			float jetLobes = pow(clamp(cos(fAng * 20.0 - 1.6) * 0.5 + 0.5, 0.0, 1.0), 1.6);
			float plungeBand = exp(-pow((fDist - 1.06) / 0.11, 2.0));
			float lacyNoise = smoothstep(0.18, 0.82, noise.x * 0.5 + 0.5);
			float rippleStreak = 0.45 + 0.55 * sin(fDist * 38.0 - time * 9.0 + noise.y * 5.5);
			float foamAmt = clamp(plungeBand * (0.28 + 0.72 * jetLobes) * lacyNoise * rippleStreak * 0.92, 0.0, 0.74);
			vec3 foamCol = vec3(0.86, 0.89, 0.90);
			vec3 outgoingLight = mix(albedo * 0.64, foamCol, foamAmt);
			// Shallow shore transparency lets sunlit pebbles & caustics shine clearly through, deep pond stays rich mirror!
			float waterAlpha = mix(clamp(0.32 + waterDepth * 0.64, 0.32, 0.94), 0.94, foamAmt);
			waterAlpha *= smoothstep(0.08, 0.25, insideShore);`,
		)
		.replace(
			'gl_FragColor = vec4( outgoingLight, alpha );',
			'gl_FragColor = vec4( outgoingLight, waterAlpha );',
		);

	group.add( lakeWater );

	// 3. Carved Fluted Limestone Tiered Fountain + Churning Basin Pools + Turbulent Streams + Spray Mist
	const limestoneTex = shapedSurfaceToThreeTextures( synthesizeCarvedLimestoneSurface( 512, 61 ), 2 );
	const fountainData = buildStoneFountainGeometry( 48 );
	const fountainMat = new THREE.MeshStandardMaterial( {
		map: limestoneTex.map,
		normalMap: useNormal ? limestoneTex.normalMap : null,
		normalScale: new THREE.Vector2( 1.05, 1.05 ),
		aoMap: limestoneTex.ormMap,
		roughnessMap: limestoneTex.ormMap,
		roughness: 0.66,
		metalness: 0.02,
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

	// Animated churning dark water discs inside upper & lower fountain basins (NO parallel wave banding!)
	const makePoolFoamMat = ( splashR: number ) => {

		const mat = new THREE.MeshStandardMaterial( {
			color: new THREE.Color( '#183020' ),
			normalMap: useNormal ? waterNormTex : null,
			normalScale: new THREE.Vector2( 0.24, 0.24 ),
			roughness: 0.32,
			metalness: 0.04,
			transparent: true,
			opacity: 0.94,
			envMapIntensity: 0.14,
			wireframe,
		} );
		mat.onBeforeCompile = ( shader ) => {

			shader.uniforms.uStreamTime = waterStreamUniforms.uTime;
			shader.uniforms.uSplashR = { value: splashR };
			shader.vertexShader = shader.vertexShader
				.replace( '#include <common>', '#include <common>\nvarying vec2 vPoolLocal;' )
				.replace( '#include <begin_vertex>', '#include <begin_vertex>\nvPoolLocal = position.xz;' );
			shader.fragmentShader = shader.fragmentShader
				.replace( '#include <common>', '#include <common>\nuniform float uStreamTime;\nuniform float uSplashR;\nvarying vec2 vPoolLocal;' )
				.replace(
					'#include <dithering_fragment>',
					`float pr = length(vPoolLocal);
					float ang = atan(vPoolLocal.y, vPoolLocal.x);
					float ring = exp(-pow((pr - uSplashR) / 0.055, 2.0));
					float lobes = pow(clamp(cos(ang * 16.0 - 1.9) * 0.5 + 0.5, 0.0, 1.0), 1.6);
					float churn = pow(clamp(0.50 + 0.50 * sin(pr * 42.0 - uStreamTime * 8.2 + sin(ang * 12.0 + uStreamTime * 3.5)), 0.0, 1.0), 2.0);
					float fMask = clamp(ring * (0.28 + 0.72 * lobes) * churn * 0.85, 0.0, 0.68);
					gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.88, 0.90, 0.88), fMask);
					#include <dithering_fragment>`,
				);

		};
		return mat;

	};

	const lowerDisc = new THREE.Mesh( new THREE.CircleGeometry( 0.76, 40 ).rotateX( - Math.PI / 2 ), makePoolFoamMat( 0.58 ) );
	lowerDisc.position.y = fountainData.lowerPoolWaterY;
	lowerDisc.receiveShadow = false;
	const upperDisc = new THREE.Mesh( new THREE.CircleGeometry( 0.40, 32 ).rotateX( - Math.PI / 2 ), makePoolFoamMat( 0.27 ) );
	upperDisc.position.y = fountainData.upperPoolWaterY;
	upperDisc.receiveShadow = false;
	fountainGroup.add( lowerDisc, upperDisc );

	// Animated cascading turbulent fountain streams (broken droplet streaks, NOT stiff solid cylinders!)
	const streamBuf = buildFountainWaterStreamsGeometry(
		fountainData.lowerPoolWaterY,
		fountainData.upperPoolWaterY,
		fountainData.nozzleTipY,
	);
	const streamMat = new THREE.MeshPhysicalMaterial( {
		vertexColors: true,
		color: new THREE.Color( '#e8f5fa' ),
		roughness: 0.08,
		metalness: 0.0,
		clearcoat: 1.0,
		transparent: true,
		opacity: 0.66,
		depthWrite: false,
		envMapIntensity: 1.8,
		wireframe,
	} );
	streamMat.onBeforeCompile = ( shader ) => {

		shader.uniforms.uStreamTime = waterStreamUniforms.uTime;
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nvarying vec2 vStreamUv;' )
			.replace( '#include <begin_vertex>', '#include <begin_vertex>\nvStreamUv = uv;' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', '#include <common>\nvarying vec2 vStreamUv;\nuniform float uStreamTime;' )
			.replace(
				'#include <dithering_fragment>',
				`float sFlowA = sin(vStreamUv.y * 34.0 - uStreamTime * 11.5 + sin(vStreamUv.x * 18.0));
				float sFlowB = cos(vStreamUv.y * 58.0 - uStreamTime * 16.0 + vStreamUv.x * 12.0);
				float streak = clamp(0.45 + 0.55 * (sFlowA * 0.6 + sFlowB * 0.4), 0.12, 1.0);
				gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.98, 0.99, 1.0), 0.52 * streak);
				gl_FragColor.a *= (0.38 + 0.62 * streak);
				#include <dithering_fragment>`,
			);

	};
	const streamMesh = new THREE.Mesh( buffersToThreeGeometry( streamBuf ), streamMat );
	streamMesh.name = 'fountain_water_jets';
	fountainGroup.add( streamMesh );

	// Animated airborne water spray & plunge splash droplets around fountain tiers
	const nDrops = 220;
	const dropSeeds = new Float32Array( nDrops * 3 );
	const dropPos = new Float32Array( nDrops * 3 );
	const dRng = new Mulberry32( 8842 );
	for ( let i = 0; i < nDrops; i ++ ) {

		dropSeeds[ i * 3 ] = dRng.range( 0, Math.PI * 2 ); // angle
		dropSeeds[ i * 3 + 1 ] = dRng.next(); // phase
		dropSeeds[ i * 3 + 2 ] = i < 70 ? 0 : i < 140 ? 1 : 2; // tier 0=plume, 1=lower, 2=pond splash

	}
	const dropGeo = new THREE.BufferGeometry();
	dropGeo.setAttribute( 'position', new THREE.BufferAttribute( dropPos, 3 ) );
	const dropMat = new THREE.PointsMaterial( {
		color: new THREE.Color( '#f3fbff' ),
		size: 0.036,
		transparent: true,
		opacity: 0.72,
		depthWrite: false,
	} );
	const dropPoints = new THREE.Points( dropGeo, dropMat );
	dropPoints.name = 'fountain_spray_droplets';
	fountainGroup.add( dropPoints );

	const updateSprayDroplets = ( tSec: number ) => {

		const posAttr = dropGeo.getAttribute( 'position' ) as THREE.BufferAttribute;
		for ( let i = 0; i < nDrops; i ++ ) {

			const ang = dropSeeds[ i * 3 ]!;
			const ph = ( dropSeeds[ i * 3 + 1 ]! + tSec * 1.15 ) % 1.0;
			const tier = dropSeeds[ i * 3 + 2 ]!;
			let r: number, y: number;
			if ( tier === 0 ) {

				r = 0.03 + ph * 0.28;
				y = fountainData.nozzleTipY + 4 * ph * ( 1 - ph ) * 0.58 - ph * 0.52;

			} else if ( tier === 1 ) {

				r = 0.45 + ph * 0.18;
				y = fountainData.upperPoolWaterY + 0.04 - ph * ph * 0.80;

			} else {

				r = 0.92 + ph * 0.24;
				y = WATER_LEVEL + 0.04 + 4 * ph * ( 1 - ph ) * 0.14;

			}
			posAttr.setXYZ( i, Math.cos( ang ) * r, y, Math.sin( ang ) * r );

		}
		posAttr.needsUpdate = true;

	};
	updateSprayDroplets( 0 );

	group.add( fountainGroup );

	// 4. Winding Irregular Split-Slate Flagstone Path (石板路)
	const slateTex = shapedSurfaceToThreeTextures( synthesizeFlagstoneSlateSurface( 512, 83 ), 1.4 );
	const slateMat = new THREE.MeshStandardMaterial( {
		map: slateTex.map,
		normalMap: useNormal ? slateTex.normalMap : null,
		normalScale: new THREE.Vector2( 1.25, 1.25 ),
		aoMap: slateTex.ormMap,
		roughnessMap: slateTex.ormMap,
		roughness: 0.78,
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
		slabMesh.position.set( slab.cx, slab.y + 0.006, slab.cz );
		slabMesh.rotation.set( slab.tiltX, slab.yaw, slab.tiltZ );
		slabMesh.castShadow = true;
		slabMesh.receiveShadow = true;
		pathGroup.add( slabMesh );

	}
	group.add( pathGroup );

	// 5. Sharp Stratified Karst Limestone Rockery (假山 — 512x512 Surface::shaped Karst + Moss PBR)
	const scholarTex = shapedSurfaceToThreeTextures( synthesizeScholarRockSurface( 512, 109 ), 2 );
	const rockeryMat = new THREE.MeshStandardMaterial( {
		map: scholarTex.map,
		normalMap: useNormal ? scholarTex.normalMap : null,
		normalScale: new THREE.Vector2( 1.55, 1.55 ),
		aoMap: scholarTex.ormMap,
		roughnessMap: scholarTex.ormMap,
		roughness: 0.84,
		metalness: 0.02,
		vertexColors: true,
		wireframe,
	} );
	const rockeryGroup = new THREE.Group();
	rockeryGroup.name = 'scholar_rockery';
	for ( const st of [ ...plan.rockeryStones, ...plan.shoreBoulders ] ) {

		const rockGeo = buffersToThreeGeometry( buildScholarRockMesh( st ) );
		const rockMesh = new THREE.Mesh( rockGeo, rockeryMat );
		rockMesh.name = st.id;
		rockMesh.position.set( st.x, st.y, st.z );
		rockMesh.rotation.y = st.yaw;
		rockMesh.castShadow = true;
		rockMesh.receiveShadow = true;
		rockeryGroup.add( rockMesh );

	}
	group.add( rockeryGroup );

	// 5b. Woodland Fern Rosettes tucked around Rockery pockets & Shoreline boulders
	if ( plan.ferns.length > 0 ) {

		const fernAtlas = synthesizeLeafSprigAtlas( 'fern', 512, 0.40 );
		const fm0 = fernAtlas.albedoMips[ 0 ]!;
		const fernMap = new THREE.DataTexture( fm0.data, fm0.width, fm0.height, THREE.RGBAFormat );
		fernMap.colorSpace = THREE.SRGBColorSpace;
		fernMap.mipmaps = fernAtlas.albedoMips.map( ( m ) => ( { data: m.data, width: m.width, height: m.height } ) );
		fernMap.generateMipmaps = false;
		fernMap.minFilter = THREE.LinearMipmapLinearFilter;
		fernMap.magFilter = THREE.LinearFilter;
		fernMap.needsUpdate = true;

		const fernNormal = new THREE.DataTexture( fernAtlas.normalLinear, fernAtlas.size, fernAtlas.size, THREE.RGBAFormat );
		fernNormal.colorSpace = THREE.NoColorSpace;
		fernNormal.generateMipmaps = true;
		fernNormal.needsUpdate = true;

		const fernMat = new THREE.MeshStandardMaterial( {
			map: fernMap,
			normalMap: useNormal ? fernNormal : null,
			normalScale: new THREE.Vector2( 0.85, 0.85 ),
			alphaTest: 0.40,
			side: THREE.FrontSide,
			roughness: 0.72,
			envMapIntensity: 0.16,
			vertexColors: true,
			wireframe,
		} );
		attachWindSway( fernMat, windUniforms, 0.055, { subsurface: true } );
		const fernGeo = buffersToThreeGeometry( buildFernRosette( 707, 9 ) );
		const fernInst = new THREE.InstancedMesh( fernGeo, fernMat, plan.ferns.length );
		fernInst.name = 'woodland_ferns';
		fernInst.castShadow = true;
		fernInst.receiveShadow = true;
		const fDummy = new THREE.Object3D();
		for ( let i = 0; i < plan.ferns.length; i ++ ) {

			const fn = plan.ferns[ i ]!;
			fDummy.position.set( fn.x, fn.y, fn.z );
			fDummy.rotation.set( 0, fn.yaw, 0 );
			fDummy.scale.setScalar( fn.scale );
			fDummy.updateMatrix();
			fernInst.setMatrixAt( i, fDummy.matrix );

		}
		fernInst.instanceMatrix.needsUpdate = true;
		group.add( fernInst );

	}

	// 6. Floating Water Lilies + Low-Profile Floating Lotus Blooms & Shallow Shoreline Reeds
	const lilyGeo = new THREE.CircleGeometry( 1, 24, 0.16, Math.PI * 1.90 );
	lilyGeo.rotateX( - Math.PI / 2 );
	const lilyMat = new THREE.MeshStandardMaterial( {
		color: new THREE.Color( '#356b2e' ),
		roughness: 0.34,
		metalness: 0.0,
		side: THREE.DoubleSide,
		wireframe,
	} );
	const lilyInst = new THREE.InstancedMesh( lilyGeo, lilyMat, Math.max( 1, plan.lilyPads.length ) );
	lilyInst.name = 'lake_lily_pads';
	lilyInst.receiveShadow = true;
	const dummy = new THREE.Object3D();

	const lotusFl = buildFlowerClump( 'rose', 888, 0.02 );
	const lotusPetalMat = new THREE.MeshPhysicalMaterial( {
		vertexColors: true,
		roughness: 0.34,
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

	const reedGeo = buffersToThreeGeometry( buildGrassClump( 'sedge', 311, 22 ) );
	const reedMat = new THREE.MeshStandardMaterial( {
		vertexColors: true,
		roughness: 0.68,
		envMapIntensity: 0.16,
		side: THREE.DoubleSide,
		wireframe,
	} );
	attachWindSway( reedMat, windUniforms, 0.075, { subsurface: true } );
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

	// 7. Courtyard Trees (unique 512px seeds) + 36 Horizon Woodland Trees (shared prototype geometry/materials!)
	for ( const tr of plan.trees ) {

		const tree = buildTreeMeshGroup( tr.preset, tr.seed + seedOffset, windUniforms, {
			showLeaves,
			useNormalMap: useNormal,
			wireframe,
			heightScale: tr.heightScale,
			atlasSize: 512,
		} );
		tree.position.set( tr.x, tr.y, tr.z );
		group.add( tree );

	}

	const horizonPrototypes: Record<'oak' | 'pine' | 'birch', THREE.Group> = {
		oak: buildTreeMeshGroup( 'oak', 9101 + seedOffset, windUniforms, { showLeaves, useNormalMap: useNormal, wireframe, heightScale: 1.0, atlasSize: 256, lod: 'horizon', castShadow: false } ),
		pine: buildTreeMeshGroup( 'pine', 9202 + seedOffset, windUniforms, { showLeaves, useNormalMap: useNormal, wireframe, heightScale: 1.0, atlasSize: 256, lod: 'horizon', castShadow: false } ),
		birch: buildTreeMeshGroup( 'birch', 9303 + seedOffset, windUniforms, { showLeaves, useNormalMap: useNormal, wireframe, heightScale: 1.0, atlasSize: 256, lod: 'horizon', castShadow: false } ),
	};
	const horizonGroup = new THREE.Group();
	horizonGroup.name = 'distant_horizon_forest';
	for ( let i = 0; i < plan.distantTrees.length; i ++ ) {

		const dt = plan.distantTrees[ i ]!;
		const clone = horizonPrototypes[ dt.preset ].clone();
		clone.position.set( dt.x, dt.y, dt.z );
		clone.rotation.y = ( dt.seed * 0.73 ) % ( Math.PI * 2 );
		clone.scale.setScalar( dt.heightScale );
		horizonGroup.add( clone );

	}
	group.add( horizonGroup );

	// 7b. Dense Woodland Understory Shrubs (34-leaf fine sprig atlas — zero giant leaf cards!)
	if ( plan.shrubs.length > 0 ) {

		const shrubAtlas = synthesizeLeafSprigAtlas( 'shrub', 256, 0.40 );
		const sm0 = shrubAtlas.albedoMips[ 0 ]!;
		const shrubMap = new THREE.DataTexture( sm0.data, sm0.width, sm0.height, THREE.RGBAFormat );
		shrubMap.colorSpace = THREE.SRGBColorSpace;
		shrubMap.mipmaps = shrubAtlas.albedoMips.map( ( m ) => ( { data: m.data, width: m.width, height: m.height } ) );
		shrubMap.generateMipmaps = false;
		shrubMap.minFilter = THREE.LinearMipmapLinearFilter;
		shrubMap.magFilter = THREE.LinearFilter;
		shrubMap.needsUpdate = true;

		const shrubMat = new THREE.MeshStandardMaterial( {
			map: shrubMap,
			alphaTest: 0.40,
			side: THREE.FrontSide,
			roughness: 0.78,
			envMapIntensity: 0.14,
			vertexColors: true,
			wireframe,
		} );
		attachWindSway( shrubMat, windUniforms, 0.045, { subsurface: true } );
		const shrubGeo = buffersToThreeGeometry( buildWoodlandShrub( 1828, 42 ) );
		const shrubInst = new THREE.InstancedMesh( shrubGeo, shrubMat, plan.shrubs.length );
		shrubInst.name = 'woodland_understory_shrubs';
		shrubInst.castShadow = false;
		shrubInst.receiveShadow = true;
		const sTint = new THREE.Color();
		const sRng = new Mulberry32( 7331 );
		for ( let i = 0; i < plan.shrubs.length; i ++ ) {

			const sh = plan.shrubs[ i ]!;
			dummy.position.set( sh.x, sh.y, sh.z );
			dummy.rotation.set( 0, sh.yaw, 0 );
			dummy.scale.set( sh.scale, sh.scale * sRng.range( 0.85, 1.25 ), sh.scale );
			dummy.updateMatrix();
			shrubInst.setMatrixAt( i, dummy.matrix );
			sTint.setRGB( sRng.range( 0.72, 1.08 ), sRng.range( 0.78, 1.05 ), sRng.range( 0.58, 0.88 ) );
			shrubInst.setColorAt( i, sTint );

		}
		shrubInst.instanceMatrix.needsUpdate = true;
		if ( shrubInst.instanceColor ) shrubInst.instanceColor.needsUpdate = true;
		group.add( shrubInst );

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

	// 9. Dense Continuous Wild Meadow Grass (2,400 tufts = ~28,800 flowing blades) + 600 Accent Grass Clumps
	if ( plan.meadowTufts.length > 0 ) {

		const meadowGeo = buffersToThreeGeometry( buildMeadowTuft( 515 + seedOffset, 12 ) );
		const meadowMat = new THREE.MeshStandardMaterial( {
			vertexColors: true,
			roughness: 0.76,
			metalness: 0.0,
			envMapIntensity: 0.12,
			side: THREE.DoubleSide,
			wireframe,
		} );
		attachWindSway( meadowMat, windUniforms, 0.058, { subsurface: true } );
		const meadowInst = new THREE.InstancedMesh( meadowGeo, meadowMat, plan.meadowTufts.length );
		meadowInst.name = 'continuous_meadow_turf';
		meadowInst.castShadow = false;
		meadowInst.receiveShadow = true;
		const tint = new THREE.Color();
		const mRng = new Mulberry32( 6121 );
		for ( let i = 0; i < plan.meadowTufts.length; i ++ ) {

			const g = plan.meadowTufts[ i ]!;
			dummy.position.set( g.x, g.y, g.z );
			dummy.rotation.set( 0, g.yaw, 0 );
			dummy.scale.set( g.scale, g.scale * mRng.range( 0.85, 1.15 ), g.scale );
			dummy.updateMatrix();
			meadowInst.setMatrixAt( i, dummy.matrix );
			tint.setRGB( mRng.range( 0.78, 1.15 ), mRng.range( 0.84, 1.12 ), mRng.range( 0.72, 1.02 ) );
			meadowInst.setColorAt( i, tint );

		}
		meadowInst.instanceMatrix.needsUpdate = true;
		if ( meadowInst.instanceColor ) meadowInst.instanceColor.needsUpdate = true;
		group.add( meadowInst );

	}

	const grassGroups: Record<GrassPresetId, typeof plan.grassClumps> = {
		fescue: [],
		foxtail: [],
		sedge: [],
	};
	for ( const gr of plan.grassClumps ) grassGroups[ gr.preset ].push( gr );

	for ( const preset of [ 'fescue', 'foxtail', 'sedge' ] as const ) {

		const list = grassGroups[ preset ];
		if ( list.length === 0 ) continue;
		const geo = buffersToThreeGeometry( buildGrassClump( preset, 71 + preset.length * 13, 24 ) );
		const mat = new THREE.MeshStandardMaterial( {
			vertexColors: true,
			roughness: 0.76,
			metalness: 0.0,
			envMapIntensity: 0.12,
			side: THREE.DoubleSide,
			wireframe,
		} );
		attachWindSway( mat, windUniforms, 0.065, { subsurface: true } );
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
			dummy.scale.set( g.scale, g.scale * 0.90, g.scale );
			dummy.updateMatrix();
			inst.setMatrixAt( i, dummy.matrix );
			tint.setRGB( tintRng.range( 0.80, 1.14 ), tintRng.range( 0.86, 1.12 ), tintRng.range( 0.74, 1.04 ) );
			inst.setColorAt( i, tint );

		}
		inst.instanceMatrix.needsUpdate = true;
		if ( inst.instanceColor ) inst.instanceColor.needsUpdate = true;
		group.add( inst );

	}

	const updateWaterTime = ( tSec: number ) => {

		waterMat.uniforms[ 'time' ]!.value = tSec;
		waterStreamUniforms.uTime.value = tSec;
		waterNormTex.offset.set( ( tSec * 0.032 ) % 1, ( tSec * 0.022 ) % 1 );
		updateSprayDroplets( tSec );

	};

	return { group, plan, animatedMaps, waterStreamUniforms, lakeWater, updateWaterTime };

}
