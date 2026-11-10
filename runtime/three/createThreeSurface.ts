/**
 * Three.js Adapter for ThreeJSWorld Pure-Data Buffers, Surface::shaped PBR Textures,
 * Specular AA, and Elevation/Azimuth Impostor Smoothstep+Dither Transition Shaders.
 */

import * as THREE from 'three';
import type { MeshBuffers } from '../core/geometryPrimitives.ts';
import type { ShapedSurfaceBuffers } from '../core/shapedSurface.ts';

export interface ThreeSurfaceTextures {
	map: THREE.DataTexture;
	normalMap: THREE.DataTexture;
	ormMap: THREE.DataTexture;
}

export function buffersToThreeGeometry( buf: MeshBuffers ): THREE.BufferGeometry {

	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.BufferAttribute( buf.positions, 3 ) );
	geo.setAttribute( 'normal', new THREE.BufferAttribute( buf.normals, 3 ) );
	geo.setAttribute( 'uv', new THREE.BufferAttribute( buf.uvs, 2 ) );
	if ( buf.colors ) geo.setAttribute( 'color', new THREE.BufferAttribute( buf.colors, 3 ) );
	if ( buf.windWeights ) geo.setAttribute( 'aWind', new THREE.BufferAttribute( buf.windWeights, 1 ) );
	geo.setIndex( new THREE.BufferAttribute( buf.indices, 1 ) );
	geo.computeBoundingSphere();
	geo.computeBoundingBox();
	return geo;

}

export function shapedSurfaceToThreeTextures( surf: ShapedSurfaceBuffers, repeat = 1 ): ThreeSurfaceTextures {

	const configure = ( tex: THREE.DataTexture, srgb: boolean ): THREE.DataTexture => {

		tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set( repeat, repeat );
		tex.minFilter = THREE.LinearMipmapLinearFilter;
		tex.magFilter = THREE.LinearFilter;
		tex.generateMipmaps = true;
		tex.needsUpdate = true;
		return tex;

	};

	const map = configure( new THREE.DataTexture( surf.albedoSRGB, surf.width, surf.height, THREE.RGBAFormat ), true );
	const normalMap = configure( new THREE.DataTexture( surf.normalLinear, surf.width, surf.height, THREE.RGBAFormat ), false );
	const ormMap = configure( new THREE.DataTexture( surf.ormLinear, surf.width, surf.height, THREE.RGBAFormat ), false );

	return { map, normalMap, ormMap };

}

export function applyImpostorFadeShader(
	material: THREE.MeshStandardMaterial,
	fadeUniform: { value: number },
	mode: 'fade-in' | 'fade-out',
): void {

	material.onBeforeCompile = ( shader ) => {

		shader.uniforms.uImpostorFade = fadeUniform;
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				uniform float uImpostorFade;
				float screenDither(vec2 coord) {
					return fract(sin(dot(floor(coord), vec2(12.9898, 78.233))) * 43758.5453);
				}`,
			)
			.replace(
				'#include <alphatest_fragment>',
				`#include <alphatest_fragment>
				float dither = screenDither(gl_FragCoord.xy);
				${ mode === 'fade-out'
					? 'if (uImpostorFade >= 1.0 || dither < uImpostorFade) discard;'
					: 'if (uImpostorFade <= 0.0 || dither > uImpostorFade) discard;' }`,
			);

	};
	material.customProgramCacheKey = () => `threejsworld-impostor-${ mode }`;

}
