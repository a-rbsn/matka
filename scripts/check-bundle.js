// After `vite build`: none of the server's code, nor Stripe's, made it into what the browser gets.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CLIENT = '.svelte-kit/output/client';
/** Strings only the server code (or a Stripe client) contains. */
const SERVER_ONLY = [
	'matka-refund:',
	'randomInt',
	'idempotencyKey',
	'constructEvent',
	'api.stripe.com'
];

async function* files(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* files(path);
		else if (/\.(js|mjs)$/.test(entry.name)) yield path;
	}
}

let checked = 0;
const found = [];
for await (const file of files(CLIENT)) {
	checked++;
	const text = await readFile(file, 'utf8');
	for (const s of SERVER_ONLY) if (text.includes(s)) found.push(`${file}: ${s}`);
}
if (!checked) throw new Error(`No client files in ${CLIENT}: run vite build first`);
if (found.length) {
	console.error('Server code in the client bundle:\n' + found.join('\n'));
	process.exit(1);
}
console.info(`check-bundle: ${checked} client files, no server code`);
