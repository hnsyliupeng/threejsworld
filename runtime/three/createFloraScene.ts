/**
 * Three.js Photorealistic Botanical Builders & Procedural Sky/IBL Environment
 * Fuses Surface::shaped PBR, coverage-preserving alpha mipmaps, upNormalCards,
 * 3-level recursive tree skeletons, sculpted 3D flowers, V-creased grass tufts,
 * and quadratic wind sway shaders.
 */

import * as THREE from 'three';
import {
	Mulberry32,
	buildFlowerClump,
	buildGrassClump,
	buildWeatheredRock,
	generateRealisticTree,
	granitePresetSurface,
	synthesizeBarkSurface,
	synthesizeLeafSprigAtlas,
	synthesizeSoilSurface,
	type FlowerPresetId,
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
			uSunDir: { value: new THREE.Vector3( 0.58, 0.60, 0.55 ).normalize() },
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
				vec3 zenith = vec3(0.14, 0.36, 0.72);
				vec3 horizon = vec3(0.68, 0.81, 0.94);
				vec3 ground = vec3(0.18, 0.22, 0.14);
				vec3 col = h >= 0.0
					? mix(horizon, zenith, pow(h, 0.52))
					: mix(horizon, ground, clamp(-h * 4.0, 0.0, 1.0));
				float sunDot = max(0.0, dot(dir, uSunDir));
				col += vec3(1.0, 0.85, 0.60) * pow(sunDot, 12.0) * 0.35;
				col += vec3(1.4, 1.25, 0.95) * smoothstep(0.996, 0.9995, sunDot);
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
