#!/usr/bin/env node
/**
 * Cook Round Audit Harness (`tools/cook_audit.mjs`)
 * Implements Leonxlnx/cook visual comparison, HSV color delta check, and
 * quantitative Water Flow Motion verification (`t=0.0s` vs `t=1.4s`).
 *
 * Usage: node tools/cook_audit.mjs --round r01
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire( '/tmp/browser_test/package.json' );
const puppeteer = require( 'puppeteer-core' );
const chromiumMod = require( '@sparticuz/chromium' );
const chromium = chromiumMod.default || chromiumMod;

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const ROOT = path.resolve( __dirname, '..' );

const argRoundIdx = process.argv.indexOf( '--round' );
const ROUND_ID = argRoundIdx >= 0 && process.argv[ argRoundIdx + 1 ] ? process.argv[ argRoundIdx + 1 ] : 'r01';

const STILLS_DIR = path.join( ROOT, 'cook', 'stills', ROUND_ID );
const COMPARE_DIR = path.join( ROOT, 'cook', 'compare', ROUND_ID );
fs.mkdirSync( STILLS_DIR, { recursive: true } );
fs.mkdirSync( COMPARE_DIR, { recursive: true } );

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.ts': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
};

const SHOTS = [
	{ id: 'S01', ref: 'cook/refs/R01_hero.png', cam: 'hero', mode: 'all', species: 'oak', tSec: 0.65 },
	{ id: 'S02', ref: 'cook/refs/R02_fountain_water.png', cam: 'closeup', mode: 'all', species: 'oak', tSec: 1.40, measureMotionFromT0: true },
	{ id: 'S03', ref: 'cook/refs/R03_rockery_path.png', cam: 'rockery', mode: 'all', species: 'oak', tSec: 0.65 },
	{ id: 'S04', ref: 'cook/refs/R04_aerial_meadow.png', cam: 'aerial', mode: 'all', species: 'oak', tSec: 0.65 },
];

function startStaticServer() {

	return new Promise( ( resolve ) => {

		const server = http.createServer( ( req, res ) => {

			const urlPath = decodeURIComponent( ( req.url || '/' ).split( '?' )[ 0 ] );
			const rel = urlPath === '/' ? 'examples/botanical_inspector.html' : urlPath.replace( /^\/+/, '' );
			const fp = path.resolve( ROOT, rel );
			if ( ! fp.startsWith( ROOT ) || ! fs.existsSync( fp ) || fs.statSync( fp ).isDirectory() ) {

				res.writeHead( 404 );
				res.end( 'Not Found' );
				return;

			}
			const ext = path.extname( fp );
			res.writeHead( 200, { 'Content-Type': MIME[ ext ] || 'application/octet-stream' } );
			if ( ext === '.ts' ) {

				const src = fs.readFileSync( fp, 'utf8' );
				const js = stripTypeScriptTypes( src, { mode: 'transform', sourceUrl: urlPath } );
				res.end( js );
				return;

			}
			fs.createReadStream( fp ).pipe( res );

		} );
		server.listen( 0, '127.0.0.1', () => resolve( server ) );

	} );

}

async function run() {

	const server = await startStaticServer();
	const port = server.address().port;
	const baseUrl = `http://127.0.0.1:${ port }`;

	const exe = await chromium.executablePath();
	const cleanArgs = chromium.args.filter( ( a ) => a !== '--single-process' && ! a.startsWith( '--headless' ) );
	const browser = await puppeteer.launch( {
		executablePath: exe,
		headless: 'shell',
		env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp' },
		args: [
			...cleanArgs,
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'--use-gl=angle',
			'--use-angle=swiftshader',
			'--enable-unsafe-swiftshader',
			'--ignore-gpu-blocklist',
		],
	} );

	const warnings = [];
	const errors = [];

	try {

		const page = await browser.newPage();
		await page.setViewport( { width: 1376, height: 768, deviceScaleFactor: 1 } );
		page.on( 'console', ( msg ) => {

			if ( msg.type() === 'warning' ) warnings.push( msg.text() );
			if ( msg.type() === 'error' ) errors.push( msg.text() );

		} );
		page.on( 'pageerror', ( err ) => errors.push( err.message ) );

		// Load once cleanly in Garden mode, then fast-switch cameras & deterministic time!
		const firstUrl = `${ baseUrl }/examples/botanical_inspector.html?clean=1&pause=1&mode=all&species=oak&cam=hero`;
		await page.goto( firstUrl, { waitUntil: 'domcontentloaded', timeout: 60000 } );
		await page.waitForFunction( () => Boolean( window.__botanicalReady ), { timeout: 60000 } );

		const stats = await page.evaluate( () => window.__botanicalStats() );
		console.log( `Cook Scene Ready: ${ stats.replace( /\n/g, ' | ' ) }` );

		const shotResults = [];

		for ( const s of SHOTS ) {

			await page.evaluate( ( cam ) => window.__setCamera( cam ), s.cam );

			if ( s.measureMotionFromT0 ) {

				await page.evaluate( () => window.__setTimeAndRender( 0.0 ) );
				await new Promise( ( r ) => setTimeout( r, 120 ) );
				await page.screenshot( { path: path.join( STILLS_DIR, `${ s.id }_t0.png` ) } );

			}

			await page.evaluate( ( t ) => window.__setTimeAndRender( t ), s.tSec );
			await new Promise( ( r ) => setTimeout( r, 160 ) );
			const outPng = path.join( STILLS_DIR, `${ s.id }.png` );
			await page.screenshot( { path: outPng } );
			console.log( `Captured ${ path.relative( ROOT, outPng ) }` );

			shotResults.push( { ...s, renderRel: `cook/stills/${ ROUND_ID }/${ s.id }.png` } );

		}

		// Compute side-by-side contact sheets + HSV color deltas + Water motion delta in Canvas 2D!
		const metricsPage = await browser.newPage();
		await metricsPage.setViewport( { width: 1600, height: 2200 } );
		const metrics = await metricsPage.evaluate( async ( base, shots, round ) => {

			function loadImg( src ) {

				return new Promise( ( res, rej ) => {

					const im = new Image();
					im.onload = () => res( im );
					im.onerror = () => rej( new Error( 'Load failed: ' + src ) );
					im.src = src;

				} );

			}

			function rgbToHsv( r, g, b ) {

				r /= 255; g /= 255; b /= 255;
				const max = Math.max( r, g, b ), min = Math.min( r, g, b );
				const d = max - min;
				const s = max === 0 ? 0 : d / max;
				return [ s, max ];

			}

			function cellStats( img, grid = 4 ) {

				const cw = 256, ch = 144;
				const cv = document.createElement( 'canvas' );
				cv.width = cw; cv.height = ch;
				const ctx = cv.getContext( '2d' );
				ctx.drawImage( img, 0, 0, cw, ch );
				const data = ctx.getImageData( 0, 0, cw, ch ).data;
				const out = [];
				for ( let gy = 0; gy < grid; gy ++ ) {

					for ( let gx = 0; gx < grid; gx ++ ) {

						let sSum = 0, vSum = 0, n = 0;
						const y0 = Math.floor( ( gy * ch ) / grid ), y1 = Math.floor( ( ( gy + 1 ) * ch ) / grid );
						const x0 = Math.floor( ( gx * cw ) / grid ), x1 = Math.floor( ( ( gx + 1 ) * cw ) / grid );
						for ( let y = y0; y < y1; y ++ ) {

							for ( let x = x0; x < x1; x ++ ) {

								const p = ( y * cw + x ) * 4;
								const [ s, v ] = rgbToHsv( data[ p ], data[ p + 1 ], data[ p + 2 ] );
								sSum += s; vSum += v; n ++;

							}

						}
						out.push( [ sSum / n, vSum / n ] );

					}

				}
				return out;

			}

			const colorReport = {};
			const pairs = [];
			for ( const s of shots ) {

				const refImg = await loadImg( `${ base }/${ s.ref }` );
				const renImg = await loadImg( `${ base }/${ s.renderRel }` );
				pairs.push( { s, refImg, renImg } );

				const rc = cellStats( refImg );
				const nc = cellStats( renImg );
				let sDeltaSum = 0, vDeltaSum = 0, worstS = 0, worstV = 0;
				for ( let i = 0; i < rc.length; i ++ ) {

					const ds = nc[ i ][ 0 ] - rc[ i ][ 0 ];
					const dv = nc[ i ][ 1 ] - rc[ i ][ 1 ];
					sDeltaSum += ds;
					vDeltaSum += dv;
					if ( Math.abs( ds ) > Math.abs( worstS ) ) worstS = ds;
					if ( Math.abs( dv ) > Math.abs( worstV ) ) worstV = dv;

				}
				colorReport[ s.id ] = {
					satMeanDelta: +( sDeltaSum / rc.length ).toFixed( 3 ),
					valMeanDelta: +( vDeltaSum / rc.length ).toFixed( 3 ),
					worstSatCell: +worstS.toFixed( 3 ),
					worstValCell: +worstV.toFixed( 3 ),
				};

			}

			// Measure Water Flow Motion on S02 lower half (pond & fountain splash area) between t=0 and t=1.4s
			const s02T0 = await loadImg( `${ base }/cook/stills/${ round }/S02_t0.png` );
			const s02T1 = pairs.find( ( p ) => p.s.id === 'S02' ).renImg;
			const mw = 688, mh = 384;
			const cvA = document.createElement( 'canvas' ); cvA.width = mw; cvA.height = mh;
			const cvB = document.createElement( 'canvas' ); cvB.width = mw; cvB.height = mh;
			const ctxA = cvA.getContext( '2d' ); const ctxB = cvB.getContext( '2d' );
			ctxA.drawImage( s02T0, 0, 0, mw, mh );
			ctxB.drawImage( s02T1, 0, 0, mw, mh );
			const dA = ctxA.getImageData( 0, 0, mw, mh ).data;
			const dB = ctxB.getImageData( 0, 0, mw, mh ).data;
			let sqDiffSum = 0, movedPx = 0, totalPondPx = 0;
			// Lower 60% pond & fountain zone
			for ( let y = Math.floor( mh * 0.35 ); y < mh; y ++ ) {

				for ( let x = 0; x < mw; x ++ ) {

					const p = ( y * mw + x ) * 4;
					const dr = Math.abs( dB[ p ] - dA[ p ] );
					const dg = Math.abs( dB[ p + 1 ] - dA[ p + 1 ] );
					const db = Math.abs( dB[ p + 2 ] - dA[ p + 2 ] );
					const diff = ( dr + dg + db ) / ( 3 * 255 );
					sqDiffSum += diff * diff;
					if ( diff > 0.025 ) movedPx ++;
					totalPondPx ++;

				}

			}
			const waterMotion = {
				rmsDelta: +Math.sqrt( sqDiffSum / totalPondPx ).toFixed( 4 ),
				activeMotionPct: +( ( movedPx / totalPondPx ) * 100 ).toFixed( 2 ),
			};

			// Render composite side-by-side contact sheet (Ref left | Render right, 4 rows)
			const colW = 688, rowH = 384, pad = 12, labelH = 26;
			const fullCv = document.createElement( 'canvas' );
			fullCv.width = pad + colW + pad + colW + pad;
			fullCv.height = pad + pairs.length * ( labelH + rowH + pad );
			const ctx = fullCv.getContext( '2d' );
			ctx.fillStyle = '#0f1411';
			ctx.fillRect( 0, 0, fullCv.width, fullCv.height );
			ctx.font = 'bold 14px monospace';

			const perShotSideBySide = {};
			for ( let i = 0; i < pairs.length; i ++ ) {

				const { s, refImg, renImg } = pairs[ i ];
				const yTop = pad + i * ( labelH + rowH + pad );
				ctx.fillStyle = '#b7ecb8';
				ctx.fillText( `${ s.id } REFERENCE (${ s.ref })`, pad + 4, yTop + 18 );
				ctx.fillStyle = '#ffdca8';
				const cr = colorReport[ s.id ];
				ctx.fillText( `${ s.id } RENDER [satΔ:${ cr.satMeanDelta }, valΔ:${ cr.valMeanDelta }]`, pad + colW + pad + 4, yTop + 18 );
				ctx.drawImage( refImg, pad, yTop + labelH, colW, rowH );
				ctx.drawImage( renImg, pad + colW + pad, yTop + labelH, colW, rowH );

				// Individual side-by-side PNG for focused critic pass
				const indCv = document.createElement( 'canvas' );
				indCv.width = fullCv.width;
				indCv.height = labelH + rowH + pad * 2;
				const ic = indCv.getContext( '2d' );
				ic.fillStyle = '#0f1411';
				ic.fillRect( 0, 0, indCv.width, indCv.height );
				ic.font = 'bold 15px monospace';
				ic.fillStyle = '#b7ecb8';
				ic.fillText( `${ s.id } REFERENCE`, pad + 4, pad + 18 );
				ic.fillStyle = '#ffdca8';
				ic.fillText( `${ s.id } CODE RENDER (${ round })`, pad + colW + pad + 4, pad + 18 );
				ic.drawImage( refImg, pad, pad + labelH, colW, rowH );
				ic.drawImage( renImg, pad + colW + pad, pad + labelH, colW, rowH );
				perShotSideBySide[ s.id ] = indCv.toDataURL( 'image/jpeg', 0.90 ).split( ',' )[ 1 ];

			}

			return {
				colorReport,
				waterMotion,
				allDataUrl: fullCv.toDataURL( 'image/jpeg', 0.90 ).split( ',' )[ 1 ],
				perShotSideBySide,
			};

		}, baseUrl, shotResults, ROUND_ID );

		fs.writeFileSync( path.join( COMPARE_DIR, 'all.jpg' ), Buffer.from( metrics.allDataUrl, 'base64' ) );
		for ( const [ sid, b64 ] of Object.entries( metrics.perShotSideBySide ) ) {

			fs.writeFileSync( path.join( COMPARE_DIR, `${ sid }.jpg` ), Buffer.from( b64, 'base64' ) );

		}

		console.log( 'HSV Color Deltas vs Reference:', JSON.stringify( metrics.colorReport ) );
		console.log( 'Water Flow Motion (t=0 -> t=1.4s):', JSON.stringify( metrics.waterMotion ) );
		console.log( `Saved Cook comparison sheet -> cook/compare/${ ROUND_ID }/all.jpg` );
		console.log( `Warnings: ${ warnings.length }, Errors: ${ errors.length }` );
		if ( warnings.length ) console.log( 'Warnings:', warnings );
		if ( errors.length ) {

			console.error( 'Errors:', errors );
			process.exitCode = 1;

		}
		if ( metrics.waterMotion.rmsDelta < 0.008 || metrics.waterMotion.activeMotionPct < 5.0 ) {

			console.error( 'WATER MOTION GATE FAILED: water surface looks frozen!' );
			process.exitCode = 1;

		}

	} finally {

		await browser.close();
		server.close();

	}

}

run().catch( ( e ) => {

	console.error( e );
	process.exit( 1 );

} );
