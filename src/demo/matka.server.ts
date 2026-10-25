import { mkdir } from 'node:fs/promises';
import Stripe from 'stripe';
import { dev } from '$app/env';
import {
	MATKA_FORCE_FACE,
	MATKA_STORE,
	STRIPE_SECRET_KEY,
	SUPABASE_SERVICE_ROLE_KEY,
	SUPABASE_URL
} from '$app/env/private';
import { createMatka, type MatkaStore } from '../lib/server/index.js';
import { memoryStore } from '../lib/server/memory.js';

/**
 * The demo's Matka, set up as a host site would set up its own: its own Stripe client, a store,
 * and createMatka.
 */

export const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

if (STRIPE_SECRET_KEY && !STRIPE_SECRET_KEY.startsWith('sk_test_')) {
	throw new Error('The demo refunds for real: use a test key (sk_test_…)');
}

async function makeStore(): Promise<MatkaStore> {
	if (MATKA_STORE === 'supabase') {
		if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
			throw new Error('MATKA_STORE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
		}
		const { createClient } = await import('@supabase/supabase-js');
		const { supabaseStore } = await import('../lib/server/supabase.js');
		return supabaseStore(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY));
	}
	if (MATKA_STORE === 'blobs') {
		// Netlify's local Blobs server, kept on disk in .netlify/matka-blobs (outside Netlify, the
		// store needs somewhere to talk to). On Netlify itself: getStore({ name, consistency }).
		const { getStore } = await import('@netlify/blobs');
		const { BlobsServer } = await import('@netlify/blobs/server');
		const { blobsStore } = await import('../lib/server/blobs.js');
		const directory = '.netlify/matka-blobs';
		await mkdir(directory, { recursive: true });
		const { port } = await new BlobsServer({ directory, token: 'demo' }).start();
		const url = `http://localhost:${port}`;
		return blobsStore(
			getStore({
				name: 'matka',
				siteID: 'demo',
				token: 'demo',
				edgeURL: url,
				uncachedEdgeURL: url,
				consistency: 'strong'
			})
		);
	}
	// Kept across hot reloads, so a roll made before an edit can still be revealed after it.
	const g = globalThis as { matkaDemoStore?: MatkaStore };
	return (g.matkaDemoStore ??= memoryStore());
}

const force = dev ? MATKA_FORCE_FACE : undefined;
if (force) console.info(`[demo] MATKA_FORCE_FACE: every roll is a ${force}`);

export const matka = stripe
	? createMatka({
			stripe,
			store: await makeStore(),
			// Only this site's sessions: the same Stripe account may sell elsewhere too.
			accepts: (session) => session.metadata?.matka_demo === '1',
			rng: force ? () => force : undefined
		})
	: null;
