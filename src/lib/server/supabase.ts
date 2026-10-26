import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatkaStore, Roll } from './store.js';

/** A row of matka_rolls (sql/001_matka_rolls.sql). */
interface Row {
	session_id: string;
	payment_intent: string;
	face: number;
	sides: number;
	winning_face: number;
	created_at: string;
	revealed_at: string | null;
	refund_tried_at: string | null;
	refund_id: string | null;
}

const iso = (t: string | null) => (t ? new Date(t).toISOString() : null);

const toRoll = (r: Row): Roll => ({
	sessionId: r.session_id,
	paymentIntent: r.payment_intent,
	face: r.face,
	sides: r.sides,
	winningFace: r.winning_face,
	createdAt: iso(r.created_at)!,
	revealedAt: iso(r.revealed_at),
	refundTriedAt: iso(r.refund_tried_at),
	refundId: r.refund_id
});

/**
 * Rolls in Supabase (Postgres), in the tables sql/001_matka_rolls.sql makes. Pass a client made
 * with the service role key, on the server only: the tables have row level security on and no
 * policies, so no other key can read them.
 *
 * The primary key keeps one roll per session; the reveal and refund are `update … where … is
 * null`, so only one call can make each; and a trigger stops either being changed once set.
 */
export function supabaseStore(
	client: SupabaseClient,
	{ table = 'matka_rolls', noneTable = 'matka_none' }: { table?: string; noneTable?: string } = {}
): MatkaStore {
	const rolls = () => client.from(table);

	async function get(sessionId: string) {
		const { data, error } = await rolls().select().eq('session_id', sessionId).maybeSingle();
		if (error) throw error;
		return data ? toRoll(data as Row) : null;
	}

	return {
		async create(roll) {
			const { error } = await rolls().upsert(
				{
					session_id: roll.sessionId,
					payment_intent: roll.paymentIntent,
					face: roll.face,
					sides: roll.sides,
					winning_face: roll.winningFace,
					created_at: roll.createdAt
				},
				{ onConflict: 'session_id', ignoreDuplicates: true }
			);
			if (error) throw error;
			return (await get(roll.sessionId))!;
		},
		get,
		async markRevealed(sessionId, at) {
			const { data, error } = await rolls()
				.update({ revealed_at: at })
				.eq('session_id', sessionId)
				.is('revealed_at', null)
				.select()
				.maybeSingle();
			if (error) throw error;
			if (data) return { roll: toRoll(data as Row), first: true };
			const roll = await get(sessionId);
			return roll ? { roll, first: false } : null;
		},
		async claimRefund(sessionId, at, staleBefore) {
			// refundIsStale, as two conditional updates (a row matches at most one): after a retry,
			// or after only the first try. Not one with .or(), which PostgREST also applies to the
			// rows it returns, after they've changed.
			const claim = async (last: 'refund_tried_at' | 'revealed_at') => {
				let query = rolls()
					.update({ refund_tried_at: at })
					.eq('session_id', sessionId)
					.is('refund_id', null);
				if (last === 'revealed_at') query = query.is('refund_tried_at', null);
				const { data, error } = await query.lt(last, staleBefore).select('session_id');
				if (error) throw error;
				return data.length > 0;
			};
			return (await claim('refund_tried_at')) || claim('revealed_at');
		},
		async recordRefund(sessionId, refundId) {
			const { error } = await rolls()
				.update({ refund_id: refundId })
				.eq('session_id', sessionId)
				.is('refund_id', null);
			if (error) throw error;
			const roll = await get(sessionId);
			if (!roll) throw new Error(`no roll for ${sessionId}`);
			return roll;
		},
		async listUnrevealed({ before } = {}) {
			let query = rolls().select().is('revealed_at', null);
			if (before) query = query.lt('created_at', before);
			const { data, error } = await query.order('created_at');
			if (error) throw error;
			return (data as Row[]).map(toRoll);
		},
		async listUnrefunded() {
			const { data, error } = await rolls()
				.select()
				.eq('won', true)
				.not('revealed_at', 'is', null)
				.is('refund_id', null)
				.order('created_at');
			if (error) throw error;
			return (data as Row[]).map(toRoll);
		},
		async markNone(sessionId, at) {
			const { error } = await client
				.from(noneTable)
				.upsert(
					{ session_id: sessionId, created_at: at },
					{ onConflict: 'session_id', ignoreDuplicates: true }
				);
			if (error) throw error;
		},
		async isNone(sessionId) {
			const { data, error } = await client
				.from(noneTable)
				.select('session_id')
				.eq('session_id', sessionId)
				.maybeSingle();
			if (error) throw error;
			return !!data;
		}
	};
}
