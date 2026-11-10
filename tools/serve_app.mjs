#!/usr/bin/env node
/**
 * Zero-bundler HTTP dev server for ThreeJSWorld HTML apps.
 * - Binds 0.0.0.0 so platform live preview & local headless browsers connect cleanly.
 * - Strips TypeScript types on the fly via Node 22 `module.stripTypeScriptTypes`.
 * - Serves `/vendor/three/` directly from `node_modules/three/`.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const PORT = Number( process.env.PORT || 4173 );

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.ts': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.css': 'text/css; charset=utf-8',
};

const server = http.createServer( ( req, res ) => {

	const urlPath = ( req.url || '/' ).split( '?' )[ 0 ];
	let rel = decodeURIComponent( urlPath );
	if ( rel === '/' ) rel = '/examples/botanical_inspector.html';

	let filePath;
	if ( rel.startsWith( '/vendor/three/' ) ) {

		filePath = path.join( ROOT, 'node_modules', 'three', rel.slice( '/vendor/three/'.length ) );

	} else {

		filePath = path.join( ROOT, rel );

	}

	const normRoot = path.resolve( ROOT );
	const normTarget = path.resolve( filePath );
	if ( ! normTarget.startsWith( normRoot ) || ! fs.existsSync( normTarget ) || fs.statSync( normTarget ).isDirectory() ) {

		res.writeHead( 404, { 'Content-Type': 'text/plain' } );
		res.end( `Not found: ${ rel }` );
		return;

	}

	const ext = path.extname( normTarget );
	res.setHeader( 'Access-Control-Allow-Origin', '*' );
	res.setHeader( 'Cache-Control', 'no-store' );
	res.writeHead( 200, { 'Content-Type': MIME[ ext ] || 'application/octet-stream' } );

	if ( ext === '.ts' ) {

		const src = fs.readFileSync( normTarget, 'utf8' );
		res.end( stripTypeScriptTypes( src, { mode: 'strip' } ) );

	} else {

		fs.createReadStream( normTarget ).pipe( res );

	}

} );

server.listen( PORT, '0.0.0.0', () => {

	console.log( `ThreeJSWorld dev server listening on http://0.0.0.0:${ PORT }/examples/botanical_inspector.html` );

} );
