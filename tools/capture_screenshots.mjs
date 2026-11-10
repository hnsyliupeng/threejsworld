#!/usr/bin/env node
/**
 * Automated Headless SwiftShader WebGL2 Screenshot & Visual Audit Harness
 * Captures multi-angle screenshots of Trees, Flowers, Grass, Garden, and --without Ablation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const OUT_DIR = path.join( ROOT, 'screenshots' );
const PORT = Number( process.env.PORT || 4173 );
const BASE = `http://127.0.0.1:${ PORT }/examples/botanical_inspector.html?pause=1`;

const require = createRequire( '/tmp/browser_test/package.json' );
const chromiumMod = require( '@sparticuz/chromium' );
const chromium = chromiumMod.default || chromiumMod;
const puppeteer = require( 'puppeteer-core' );

const SHOTS = [
	{ name: '01_garden_hero', state: { view: 'all', species: 'oak', cam: 'hero', leaves: true, hud: true } },
	{ name: '02_garden_fountain_lake', state: { view: 'all', species: 'oak', cam: 'closeup', leaves: true, hud: false } },
	{ name: '03_garden_rockery_flagstones', state: { view: 'all', species: 'oak', cam: 'rockery', leaves: true, hud: false } },
	{ name: '04_garden_top_down_audit', state: { view: 'all', species: 'oak', cam: 'top', leaves: true, hud: false } },
	{ name: '05_garden_rear_panorama', state: { view: 'all', species: 'oak', cam: 'back', leaves: true, hud: false } },
	{ name: '06_tree_pine_hero', state: { view: 'tree', species: 'pine', cam: 'hero', leaves: true, hud: false } },
	{ name: '07_flower_daisy_closeup', state: { view: 'flower', species: 'oak', cam: 'closeup', leaves: true, hud: false } },
	{ name: '08_flower_rose_closeup', state: { view: 'flower', species: 'pine', cam: 'closeup', leaves: true, hud: false } },
	{ name: '09_flower_tulip_closeup', state: { view: 'flower', species: 'birch', cam: 'closeup', leaves: true, hud: false } },
	{ name: '10_tree_oak_without_leaves_ablation', state: { view: 'tree', species: 'oak', cam: 'hero', leaves: false, hud: false } },
];

async function run() {

	fs.mkdirSync( OUT_DIR, { recursive: true } );
	const exe = await chromium.executablePath();
	const args = chromium.args.filter( ( a ) => a !== '--single-process' && ! a.startsWith( '--headless' ) );
	args.push( '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' );

	const browser = await puppeteer.launch( {
		args,
		defaultViewport: { width: 960, height: 640 },
		executablePath: exe,
		headless: 'shell',
		env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp' },
	} );

	const consoleErrors = [];
	const consoleWarnings = [];
	const page = await browser.newPage();
	page.on( 'console', ( msg ) => {

		if ( msg.type() === 'error' ) consoleErrors.push( msg.text() );
		if ( msg.type() === 'warning' ) consoleWarnings.push( msg.text() );

	} );
	page.on( 'pageerror', ( err ) => consoleErrors.push( String( err ) ) );

	await page.goto( BASE, { waitUntil: 'domcontentloaded', timeout: 25000 } );
	await page.waitForFunction( () => Boolean( window.__botanicalReady ), { timeout: 25000 } );

	for ( const shot of SHOTS ) {

		await page.evaluate( ( s ) => window.__setInspectionState( s ), shot.state );
		await new Promise( ( r ) => setTimeout( r, 120 ) );
		const outPath = path.join( OUT_DIR, `${ shot.name }.png` );
		await page.screenshot( { path: outPath } );
		const statsText = await page.evaluate( () => document.getElementById( 'stats' )?.textContent || '' );
		console.log( `Captured ${ shot.name }.png -> ${ statsText }` );

	}

	// Render labeled 2x5 contact sheet overview of all 10 screenshots
	const tileB64List = SHOTS.map( ( s ) => ( {
		label: s.name,
		dataUrl: 'data:image/png;base64,' + fs.readFileSync( path.join( OUT_DIR, `${ s.name }.png` ) ).toString( 'base64' ),
	} ) );
	const sheetB64 = await page.evaluate( async ( tiles ) => {

		const cols = 2;
		const rows = Math.ceil( tiles.length / cols );
		const tw = 640;
		const th = 426;
		const pad = 16;
		const header = 32;
		const canvas = document.createElement( 'canvas' );
		canvas.width = cols * tw + ( cols + 1 ) * pad;
		canvas.height = rows * ( th + header ) + ( rows + 1 ) * pad;
		const ctx = canvas.getContext( '2d' );
		ctx.fillStyle = '#0d1117';
		ctx.fillRect( 0, 0, canvas.width, canvas.height );
		ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
		ctx.textBaseline = 'middle';

		for ( let i = 0; i < tiles.length; i ++ ) {

			const col = i % cols;
			const row = Math.floor( i / cols );
			const x = pad + col * ( tw + pad );
			const y = pad + row * ( th + header + pad );

			ctx.fillStyle = '#161b22';
			ctx.fillRect( x, y, tw, header + th );
			ctx.strokeStyle = '#30363d';
			ctx.lineWidth = 2;
			ctx.strokeRect( x, y, tw, header + th );

			ctx.fillStyle = '#7ee787';
			ctx.fillText( tiles[ i ].label, x + 12, y + header / 2 );

			const img = new Image();
			img.src = tiles[ i ].dataUrl;
			await new Promise( ( res ) => {

				img.onload = res;

			} );
			ctx.drawImage( img, x, y + header, tw, th );

		}
		return canvas.toDataURL( 'image/png' ).split( ',' )[ 1 ];

	}, tileB64List );
	fs.writeFileSync( path.join( OUT_DIR, '00_all_screenshots_overview.png' ), Buffer.from( sheetB64, 'base64' ) );
	console.log( 'Captured 00_all_screenshots_overview.png (2x5 labeled overview)' );

	await browser.close();
	console.log( `Warnings: ${ consoleWarnings.length }, Errors: ${ consoleErrors.length }` );
	if ( consoleWarnings.length > 0 ) console.warn( 'Warnings:', consoleWarnings );
	if ( consoleErrors.length > 0 ) {

		console.error( 'Errors:', consoleErrors );
		process.exit( 1 );

	}

}

run().catch( ( err ) => {

	console.error( err );
	process.exit( 1 );

} );
