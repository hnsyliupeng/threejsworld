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
const OUT_DIR = path.join( ROOT, '.threejsworld', 'screenshots' );
const PORT = Number( process.env.PORT || 4173 );
const BASE = `http://127.0.0.1:${ PORT }/examples/botanical_inspector.html?pause=1`;

const require = createRequire( '/tmp/browser_test/package.json' );
const chromiumMod = require( '@sparticuz/chromium' );
const chromium = chromiumMod.default || chromiumMod;
const puppeteer = require( 'puppeteer-core' );

const SHOTS = [
	{ name: '01_garden_hero', state: { view: 'all', species: 'oak', cam: 'hero', leaves: true, hud: true } },
	{ name: '02_garden_closeup_flowers_grass', state: { view: 'all', species: 'oak', cam: 'closeup', leaves: true, hud: false } },
	{ name: '03_tree_oak_hero', state: { view: 'tree', species: 'oak', cam: 'hero', leaves: true, hud: false } },
	{ name: '04_tree_pine_hero', state: { view: 'tree', species: 'pine', cam: 'hero', leaves: true, hud: false } },
	{ name: '05_tree_birch_closeup', state: { view: 'tree', species: 'birch', cam: 'closeup', leaves: true, hud: false } },
	{ name: '06_flower_daisy_closeup', state: { view: 'flower', species: 'oak', cam: 'closeup', leaves: true, hud: false } },
	{ name: '07_flower_rose_closeup', state: { view: 'flower', species: 'pine', cam: 'closeup', leaves: true, hud: false } },
	{ name: '08_flower_tulip_closeup', state: { view: 'flower', species: 'birch', cam: 'closeup', leaves: true, hud: false } },
	{ name: '09_grass_foxtail_closeup', state: { view: 'grass', species: 'pine', cam: 'closeup', leaves: true, hud: false } },
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
