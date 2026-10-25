import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { createClient } from '@supabase/supabase-js';
import { blobsStore } from './blobs.js';
import { memoryStore } from './memory.js';
import type { MatkaStore, Roll } from './store.js';
import { supabaseStore } from './supabase.js';

/**
 * The same tests for every store. Supabase's run when MATKA_TEST_SUPABASE_URL and
 * MATKA_TEST_SUPABASE_KEY (a service role key) are set: a local `supabase start` with
 * sql/001_matka_rolls.sql applied. Each run uses its own session ids, so old rows don't matter.
 */

const run = Date.now().toString(36);
let n = 0;
const id = () => `cs_test_${run}x${n++}`;

const roll = (sessionId: string, createdAt: string, face = 3): Roll => ({
	sessionId,
	paymentIntent: 'pi_test_1',
	face,
	sides: 6,
	winningFace: 6,
	createdAt,
	revealedAt: null,
	refundTriedAt: null,
	refundId: null
});

function contract(
	name: string,
	make: () => MatkaStore | Promise<MatkaStore>,
	{ concurrent = true, skip = false } = {}
) {
	describe.skipIf(skip)(name, () => {
		let store: MatkaStore;
		beforeAll(async () => {
			store = await make();
		});

		it('creates once: a second create returns the first roll', async () => {
			const s = id();
			const first = await store.create(roll(s, '2026-10-25T12:00:00.000Z', 2));
			expect(first.face).toBe(2);
			const again = await store.create(roll(s, '2026-10-25T13:00:00.000Z', 5));
			expect(again).toEqual(first);
			expect(await store.get(s)).toEqual(first);
		});

		it('has nothing for an unknown session', async () => {
			expect(await store.get(id())).toBe(null);
			expect(await store.markRevealed(id(), '2026-10-25T12:00:00.000Z')).toBe(null);
		});

		it('reveals once, keeping the first time', async () => {
			const s = id();
			await store.create(roll(s, '2026-10-25T12:00:00.000Z'));
			const first = await store.markRevealed(s, '2026-10-25T12:01:00.000Z');
			expect(first).toMatchObject({
				first: true,
				roll: { revealedAt: '2026-10-25T12:01:00.000Z' }
			});
			const again = await store.markRevealed(s, '2026-10-25T12:02:00.000Z');
			expect(again).toMatchObject({
				first: false,
				roll: { revealedAt: '2026-10-25T12:01:00.000Z' }
			});
		});

		it('records a refund once', async () => {
			const s = id();
			await store.create(roll(s, '2026-10-25T12:00:00.000Z', 6));
			await store.markRevealed(s, '2026-10-25T12:01:00.000Z');
			expect((await store.recordRefund(s, 're_1')).refundId).toBe('re_1');
			expect((await store.recordRefund(s, 're_2')).refundId).toBe('re_1');
		});

		it('claims a refund only once its last try is stale, and not once refunded', async () => {
			const s = id();
			await store.create(roll(s, '2026-10-25T12:00:00.000Z', 6));
			expect(
				await store.claimRefund(s, '2026-10-25T12:00:30.000Z', '2026-10-25T12:00:00.000Z')
			).toBe(false);
			await store.markRevealed(s, '2026-10-25T12:01:00.000Z');
			// The first try, at the reveal, is still fresh.
			expect(
				await store.claimRefund(s, '2026-10-25T12:01:10.000Z', '2026-10-25T12:00:40.000Z')
			).toBe(false);
			expect(
				await store.claimRefund(s, '2026-10-25T12:01:40.000Z', '2026-10-25T12:01:10.000Z')
			).toBe(true);
			expect((await store.get(s))?.refundTriedAt).toBe('2026-10-25T12:01:40.000Z');
			// That try is fresh now.
			expect(
				await store.claimRefund(s, '2026-10-25T12:01:50.000Z', '2026-10-25T12:01:20.000Z')
			).toBe(false);
			expect(
				await store.claimRefund(s, '2026-10-25T12:02:20.000Z', '2026-10-25T12:01:50.000Z')
			).toBe(true);
			await store.recordRefund(s, 're_1');
			expect(
				await store.claimRefund(s, '2026-10-25T13:00:00.000Z', '2026-10-25T12:59:00.000Z')
			).toBe(false);
			expect(
				await store.claimRefund(id(), '2026-10-25T13:00:00.000Z', '2026-10-25T12:59:00.000Z')
			).toBe(false);
		});

		it('marks a session that will have no roll', async () => {
			const s = id();
			expect(await store.isNone(s)).toBe(false);
			await store.markNone(s, '2026-10-25T12:00:00.000Z');
			await store.markNone(s, '2026-10-25T12:01:00.000Z');
			expect(await store.isNone(s)).toBe(true);
			expect(await store.isNone(id())).toBe(false);
		});

		it('lists unrevealed rolls, oldest first', async () => {
			const [a, b, c] = [id(), id(), id()];
			await store.create(roll(b, '2020-01-01T00:00:02.000Z'));
			await store.create(roll(a, '2020-01-01T00:00:01.000Z'));
			await store.create(roll(c, '2020-01-01T00:00:03.000Z'));
			await store.markRevealed(c, '2026-10-25T12:00:00.000Z');
			const ours = (rolls: Roll[]) =>
				rolls.map((r) => r.sessionId).filter((s) => [a, b, c].includes(s));
			expect(ours(await store.listUnrevealed())).toEqual([a, b]);
			expect(ours(await store.listUnrevealed({ before: '2020-01-01T00:00:01.500Z' }))).toEqual([a]);
		});

		it.skipIf(!concurrent)('lets one of many concurrent reveals be first', async () => {
			const s = id();
			await store.create(roll(s, '2026-10-25T12:00:00.000Z'));
			const results = await Promise.all(
				Array.from({ length: 10 }, (_, i) => store.markRevealed(s, `2026-10-25T12:00:0${i}.000Z`))
			);
			expect(results.filter((r) => r?.first)).toHaveLength(1);
			expect(new Set(results.map((r) => r?.roll.revealedAt)).size).toBe(1);
		});

		it.skipIf(!concurrent)('lets one of many concurrent claims have the refund', async () => {
			const s = id();
			await store.create(roll(s, '2026-10-25T12:00:00.000Z', 6));
			await store.markRevealed(s, '2026-10-25T12:00:00.000Z');
			const claims = await Promise.all(
				Array.from({ length: 10 }, () =>
					store.claimRefund(s, '2026-10-25T12:01:00.000Z', '2026-10-25T12:00:30.000Z')
				)
			);
			expect(claims.filter(Boolean)).toHaveLength(1);
		});

		it.skipIf(!concurrent)('keeps one roll when concurrent creates race', async () => {
			const s = id();
			const results = await Promise.all(
				[1, 2, 3, 4, 5, 6].map((face) => store.create(roll(s, '2026-10-25T12:00:00.000Z', face)))
			);
			expect(new Set(results.map((r) => r.face)).size).toBe(1);
		});
	});
}

contract('memoryStore', memoryStore);

// Netlify's local Blobs server honours onlyIfNew and onlyIfMatch, but checks then writes without
// a lock (and its etags are file times), so it can't stand in for the real service's atomicity:
// the concurrent tests are for stores that can.
let server: BlobsServer;
let directory: string;
contract(
	'blobsStore (local Blobs server)',
	async () => {
		directory = await mkdtemp(join(tmpdir(), 'matka-blobs-'));
		server = new BlobsServer({ directory, token: 'test' });
		const { port } = await server.start();
		const url = `http://localhost:${port}`;
		return blobsStore(
			getStore({
				name: 'matka',
				siteID: 'test',
				token: 'test',
				edgeURL: url,
				uncachedEdgeURL: url,
				consistency: 'strong'
			})
		);
	},
	{ concurrent: false }
);
afterAll(async () => {
	await server?.stop();
	if (directory) await rm(directory, { recursive: true, force: true });
});

const { MATKA_TEST_SUPABASE_URL: url, MATKA_TEST_SUPABASE_KEY: key } = process.env;
contract(
	'supabaseStore (local Supabase)',
	() => supabaseStore(createClient(url!, key!, { auth: { persistSession: false } })),
	{ skip: !url || !key }
);
