import { randomInt } from 'node:crypto';
import type { MatkaReveal, MatkaStatus, NoRoll, Pending, RefundState, Rolled } from '../types.js';
import { ALREADY_REFUNDED, type MatkaStore, type Roll } from './store.js';

/**
 * The parts of a Stripe client Matka uses. A `new Stripe(key)` fits; Matka never makes its own,
 * so it's never tied to the host's Stripe version.
 */
export interface MatkaStripe {
	refunds: {
		create(
			params: {
				payment_intent: string;
				reason: 'requested_by_customer';
				metadata: Record<string, string>;
			},
			options: { idempotencyKey: string }
		): Promise<{ id: string }>;
		list(params: { payment_intent: string; limit: number }): Promise<{
			data: { id: string; status: string | null; metadata: Record<string, string> | null }[];
		}>;
	};
}

/** The parts of a Checkout session Matka reads (a Stripe.Checkout.Session fits). */
export interface MatkaSession {
	object: 'checkout.session';
	id: string;
	payment_status: string;
	payment_intent: string | { id: string } | null;
	metadata?: Record<string, string> | null;
}

/** The parts of a Stripe event Matka reads (a Stripe.Event fits). */
export interface MatkaEvent {
	type: string;
	data: { object: unknown };
}

/** What sweep() did. */
export interface MatkaSweep {
	/** Rolls it revealed (nobody had). */
	revealed: number;
	/** Wins it refunded. */
	refunded: number;
	/** Wins whose refund still failed (session ids): worth a look in Stripe. */
	pending: string[];
}

export interface MatkaOptions {
	stripe: MatkaStripe;
	store: MatkaStore;
	/**
	 * Whether a Checkout session is this site's: `(session) => session.metadata?.order != null`,
	 * say. One Stripe account can sell for several sites, and every site's webhook sees every
	 * session; a site that rolled for another's would give its customers a second roll.
	 */
	accepts: (session: MatkaSession) => boolean | Promise<boolean>;
	/** Faces on the die. Default 6. */
	sides?: number;
	/** The face that refunds the order. Default 6. */
	winningFace?: number;
	/** A roll from 1 to `sides`. Default crypto.randomInt. For tests and local demos only. */
	rng?: (sides: number) => number;
	/** The time. For tests. */
	now?: () => Date;
}

/** A request Matka won't serve (a malformed session id): `status` is the HTTP status to send. */
export class MatkaError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'MatkaError';
	}
}

/**
 * The events that settle a Checkout session's roll: paid (a card at once, a bank payment later),
 * or never to be (£0, no payment, a bank payment that failed).
 */
const EVENTS = new Set([
	'checkout.session.completed',
	'checkout.session.async_payment_succeeded',
	'checkout.session.async_payment_failed'
]);

/**
 * How long a winning roll's refund belongs to the call that last tried it. Another reveal in that
 * time leaves the refund to it; after, it tries again (the last try must have failed). So a refund
 * that keeps failing is tried at most once a lease, however often it's revealed.
 */
const REFUND_LEASE_MS = 30_000;

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{1,250}$/;

/** The payment intent of a paid session: one Matka rolls for. Otherwise (unpaid, £0) null. */
function paidWith(session: Partial<MatkaSession>): string | null {
	if (session.payment_status !== 'paid') return null;
	const pi = session.payment_intent;
	return (typeof pi === 'string' ? pi : pi?.id) || null;
}

export const isSessionId = (id: unknown): id is string =>
	typeof id === 'string' && SESSION_ID.test(id);

export function createMatka(options: MatkaOptions) {
	const { stripe, store, accepts, sides = 6, winningFace = 6 } = options;
	const rng = options.rng ?? ((n: number) => randomInt(1, n + 1));
	const now = options.now ?? (() => new Date());
	if (typeof accepts !== 'function') {
		throw new TypeError("accepts: a function that says whether a Checkout session is this site's");
	}
	if (!Number.isInteger(sides) || sides < 2)
		throw new RangeError('sides: a whole number, 2 or more');
	if (!Number.isInteger(winningFace) || winningFace < 1 || winningFace > sides) {
		throw new RangeError(`winningFace: a whole number from 1 to ${sides}`);
	}

	function check(sessionId: string) {
		if (!isSessionId(sessionId)) throw new MatkaError(400, 'not a Checkout session id');
	}

	function rolled(roll: Roll, firstReveal: boolean): Rolled {
		const win = roll.face === roll.winningFace;
		const refund: RefundState = !win ? 'none' : roll.refundId ? 'issued' : 'pending';
		return {
			status: 'rolled',
			face: roll.face,
			sides: roll.sides,
			winningFace: roll.winningFace,
			win,
			firstReveal,
			refund
		};
	}

	/**
	 * Refunds a winning roll and records it. Stripe's own record comes first (a refund this made
	 * before, then failed to record), then the idempotency key (the same request twice makes one
	 * refund). Stripe also won't refund a charge that's already fully refunded.
	 */
	async function refund(roll: Roll): Promise<Roll> {
		const { data } = await stripe.refunds.list({ payment_intent: roll.paymentIntent, limit: 100 });
		const prior = data.find(
			(r) =>
				r.metadata?.matka === roll.sessionId && r.status !== 'failed' && r.status !== 'canceled'
		);
		if (prior) return store.recordRefund(roll.sessionId, prior.id);
		try {
			const made = await stripe.refunds.create(
				{
					payment_intent: roll.paymentIntent,
					reason: 'requested_by_customer',
					metadata: { matka: roll.sessionId }
				},
				{ idempotencyKey: `matka-refund:${roll.sessionId}` }
			);
			return store.recordRefund(roll.sessionId, made.id);
		} catch (e) {
			if ((e as { code?: string }).code === 'charge_already_refunded') {
				return store.recordRefund(roll.sessionId, ALREADY_REFUNDED);
			}
			throw e;
		}
	}

	/**
	 * No roll yet: is one coming? Only the webhook's word is taken (asking Stripe here would let
	 * anyone spend the account's rate limit with made-up session ids). Marked none: never. Otherwise
	 * pending: the webhook's on its way, or a bank payment's going through.
	 */
	async function unrolled(sessionId: string): Promise<Pending | NoRoll> {
		return (await store.isNone(sessionId)) ? { status: 'none' } : { status: 'pending' };
	}

	const matka = {
		/**
		 * Rolls for a paid Checkout session. Call it in your Stripe webhook with every verified
		 * event. Sessions `accepts` turns down and other events are passed over (null). So are
		 * sessions that won't have a roll (£0, no payment, a bank payment that failed), which are
		 * marked so the endpoint can say so. A duplicate event returns the roll already made. If it
		 * throws, answer 500 so Stripe tries again.
		 */
		async handleEvent(event: MatkaEvent): Promise<Roll | null> {
			if (!EVENTS.has(event.type)) return null;
			const session = event.data.object as Partial<MatkaSession>;
			if (session?.object !== 'checkout.session' || !isSessionId(session.id)) return null;
			if (!(await accepts(session as MatkaSession))) return null;
			const paymentIntent = paidWith(session);
			if (!paymentIntent) {
				// Unpaid on completion: a bank payment going through, settled by a later event.
				const processing =
					event.type === 'checkout.session.completed' && session.payment_status === 'unpaid';
				if (!processing) await store.markNone(session.id, now().toISOString());
				return null;
			}
			const face = rng(sides);
			if (!Number.isInteger(face) || face < 1 || face > sides) {
				throw new RangeError(`rng gave ${face}, not 1 to ${sides}`);
			}
			return store.create({
				sessionId: session.id,
				paymentIntent,
				face,
				sides,
				winningFace,
				createdAt: now().toISOString(),
				revealedAt: null,
				refundTriedAt: null,
				refundId: null
			});
		},

		/**
		 * Reveals a session's roll, and refunds it if it's a win. Idempotent: every call returns the
		 * same face, and only one refund is ever made. If the refund fails, the result still comes
		 * back (refund: 'pending') and a later reveal tries again. With no roll yet: pending, or none
		 * if the webhook said no roll is coming.
		 */
		async reveal(sessionId: string): Promise<MatkaReveal> {
			check(sessionId);
			const at = now();
			const marked = await store.markRevealed(sessionId, at.toISOString());
			if (!marked) return unrolled(sessionId);
			let { roll } = marked;
			const owed = roll.face === roll.winningFace && !roll.refundId;
			const staleBefore = new Date(at.getTime() - REFUND_LEASE_MS).toISOString();
			if (
				owed &&
				(marked.first || (await store.claimRefund(sessionId, at.toISOString(), staleBefore)))
			) {
				try {
					roll = await refund(roll);
				} catch (e) {
					console.error('[matka] refund failed for', sessionId, e);
				}
			}
			return rolled(roll, marked.first);
		},

		/**
		 * A session's roll without revealing it: the face only once it's been revealed. Before the
		 * webhook, pending, or none if no roll is coming (see reveal).
		 */
		async status(sessionId: string): Promise<MatkaStatus> {
			check(sessionId);
			const roll = await store.get(sessionId);
			if (!roll) return unrolled(sessionId);
			if (!roll.revealedAt) {
				return { status: 'ready', sides: roll.sides, winningFace: roll.winningFace };
			}
			return rolled(roll, false);
		},

		/** Rolls nobody has revealed, oldest first (for a reminder email, say). */
		listUnrevealed(options?: { before?: Date }): Promise<Roll[]> {
			return store.listUnrevealed({ before: options?.before?.toISOString() });
		},

		/** Revealed wins whose refund hasn't gone through, oldest first. reveal() tries again. */
		listUnrefunded(): Promise<Roll[]> {
			return store.listUnrefunded();
		},

		/**
		 * For a scheduled job (daily, say). Reveals the rolls nobody revealed before `before`, so a
		 * six is refunded even if the customer never saw the thanks page, and tries again any refund
		 * that failed. Returns how many it revealed and refunded, and the wins still unrefunded.
		 */
		async sweep({ before }: { before: Date }): Promise<MatkaSweep> {
			const result: MatkaSweep = { revealed: 0, refunded: 0, pending: [] };
			const rolls = [
				...(await store.listUnrevealed({ before: before.toISOString() })),
				...(await store.listUnrefunded())
			];
			for (const { sessionId } of rolls) {
				const got = await matka.reveal(sessionId);
				if (got.status !== 'rolled') continue;
				if (got.firstReveal) result.revealed++;
				if (got.refund === 'issued') result.refunded++;
				if (got.refund === 'pending') result.pending.push(sessionId);
			}
			return result;
		},

		/**
		 * The endpoint <Matka> talks to, as a web-standard handler: a SvelteKit +server.ts
		 * (`export const GET = ({ request }) => matka.handler(request)`, and POST) or a Netlify
		 * Function (`export default matka.handler`). `?session_id=cs_…`: GET is status(), POST is
		 * reveal().
		 */
		handler: async (request: Request): Promise<Response> => {
			const headers = { 'cache-control': 'no-store' };
			if (request.method !== 'GET' && request.method !== 'POST') {
				return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, POST' } });
			}
			const sessionId = new URL(request.url).searchParams.get('session_id') ?? '';
			try {
				const body =
					request.method === 'POST' ? await matka.reveal(sessionId) : await matka.status(sessionId);
				return Response.json(body, { headers });
			} catch (e) {
				if (e instanceof MatkaError) {
					return Response.json({ error: e.message }, { status: e.status, headers });
				}
				console.error('[matka]', e);
				return Response.json({ error: 'something went wrong' }, { status: 500, headers });
			}
		}
	};
	return matka;
}

export type Matka = ReturnType<typeof createMatka>;
