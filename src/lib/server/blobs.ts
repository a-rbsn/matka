import type { Store } from '@netlify/blobs';
import { refundIsStale, type MatkaStore, type Roll } from './store.js';

const ROLL = 'rolls/';
const UNREVEALED = 'unrevealed/';
const NONE = 'none/';
/** Tries at a compare-and-swap before giving up (each lost race means another write won). */
const TRIES = 8;

/**
 * Rolls in Netlify Blobs. Pass a store with strong consistency, which the conditional writes
 * need: `blobsStore(getStore({ name: 'matka', consistency: 'strong' }))`.
 *
 * `rolls/<session>` holds each roll, created with onlyIfNew and changed with onlyIfMatch, so two
 * writers can't both win. `unrevealed/<session>` is an empty entry per roll not yet revealed, so
 * listUnrevealed needn't read every roll ever made. `none/<session>` marks a session that will
 * never have a roll.
 */
export function blobsStore(store: Store): MatkaStore {
	const read = async (sessionId: string) => {
		const got = await store.getWithMetadata(ROLL + sessionId, { type: 'json' });
		return got ? { roll: got.data as Roll, etag: got.etag } : null;
	};

	/** Applies `change` to the stored roll, unless it returns null (nothing to change). */
	async function swap(sessionId: string, change: (roll: Roll) => Roll | null) {
		for (let i = 0; i < TRIES; i++) {
			const got = await read(sessionId);
			if (!got) return null;
			const next = change(got.roll);
			if (!next) return { roll: got.roll, changed: false };
			const { modified } = await store.setJSON(ROLL + sessionId, next, { onlyIfMatch: got.etag });
			if (modified) return { roll: next, changed: true };
		}
		throw new Error(`[matka] gave up writing ${sessionId}: too many concurrent writes`);
	}

	return {
		async create(roll) {
			// The index first: an entry with no roll is skipped (and tidied) by listUnrevealed, but a
			// roll with no entry would never be listed.
			await store.set(UNREVEALED + roll.sessionId, '');
			const { modified } = await store.setJSON(ROLL + roll.sessionId, roll, { onlyIfNew: true });
			if (modified) return roll;
			const existing = await read(roll.sessionId);
			if (!existing) throw new Error(`[matka] ${roll.sessionId} exists but can't be read`);
			return existing.roll;
		},
		async get(sessionId) {
			return (await read(sessionId))?.roll ?? null;
		},
		async markRevealed(sessionId, at) {
			const done = await swap(sessionId, (r) => (r.revealedAt ? null : { ...r, revealedAt: at }));
			if (!done) return null;
			if (done.changed) await store.delete(UNREVEALED + sessionId);
			return { roll: done.roll, first: done.changed };
		},
		async claimRefund(sessionId, at, staleBefore) {
			const done = await swap(sessionId, (r) =>
				refundIsStale(r, staleBefore) ? { ...r, refundTriedAt: at } : null
			);
			return !!done?.changed;
		},
		async recordRefund(sessionId, refundId) {
			const done = await swap(sessionId, (r) => (r.refundId ? null : { ...r, refundId }));
			if (!done) throw new Error(`no roll for ${sessionId}`);
			return done.roll;
		},
		async listUnrevealed({ before } = {}) {
			const { blobs } = await store.list({ prefix: UNREVEALED });
			const rolls: Roll[] = [];
			for (const { key } of blobs) {
				const sessionId = key.slice(UNREVEALED.length);
				const roll = (await read(sessionId))?.roll;
				if (!roll) continue;
				// Revealed, but the entry outlived it (a crash between the two writes): tidied now.
				if (roll.revealedAt) await store.delete(key);
				else if (!before || roll.createdAt < before) rolls.push(roll);
			}
			return rolls.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		},
		async markNone(sessionId, at) {
			await store.set(NONE + sessionId, at);
		},
		async isNone(sessionId) {
			return (await store.get(NONE + sessionId)) !== null;
		}
	};
}
