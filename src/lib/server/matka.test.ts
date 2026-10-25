import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatka, type MatkaOptions, type MatkaStripe } from './matka.js';
import { memoryStore } from './memory.js';
import { ALREADY_REFUNDED } from './store.js';

const SESSION = 'cs_test_a1B2c3';
const PI = 'pi_test_123';

/** A Stripe client's refunds, kept in memory: honours the idempotency key, can be made to fail. */
function fakeStripe() {
	const refunds: {
		id: string;
		payment_intent: string;
		key: string;
		metadata: Record<string, string>;
	}[] = [];
	const fail = { next: null as null | { code?: string; message: string } };
	const create = vi.fn<MatkaStripe['refunds']['create']>(async (params, { idempotencyKey }) => {
		// A tick, so concurrent callers really overlap.
		await new Promise((r) => setTimeout(r, 1));
		if (fail.next) {
			const e = Object.assign(new Error(fail.next.message), { code: fail.next.code });
			fail.next = null;
			throw e;
		}
		const same = refunds.find((r) => r.key === idempotencyKey);
		if (same) return { id: same.id };
		const refund = {
			id: `re_${refunds.length + 1}`,
			payment_intent: params.payment_intent,
			key: idempotencyKey,
			metadata: params.metadata
		};
		refunds.push(refund);
		return { id: refund.id };
	});
	const list = vi.fn<MatkaStripe['refunds']['list']>(async ({ payment_intent }) => ({
		data: refunds
			.filter((r) => r.payment_intent === payment_intent)
			.map((r) => ({ id: r.id, status: 'succeeded', metadata: r.metadata }))
	}));
	return {
		stripe: { refunds: { create, list } } satisfies MatkaStripe,
		refunds,
		create,
		list,
		fail
	};
}

function paid(id = SESSION, type = 'checkout.session.completed', extra: object = {}) {
	return {
		type,
		data: {
			object: {
				object: 'checkout.session',
				id,
				payment_status: 'paid',
				payment_intent: PI,
				...extra
			}
		}
	};
}

let clock: number;
let faces: number[];

function setup(options: Partial<MatkaOptions> = {}) {
	const store = memoryStore();
	const fake = fakeStripe();
	const matka = createMatka({
		stripe: fake.stripe,
		store,
		accepts: () => true,
		rng: () => faces.shift() ?? 1,
		now: () => new Date(clock),
		...options
	});
	return { store, matka, ...fake };
}

beforeEach(() => {
	clock = Date.parse('2026-10-25T12:00:00Z');
	faces = [];
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('handleEvent', () => {
	it('rolls once for a paid session, even if the event comes twice', async () => {
		const { matka, store } = setup();
		faces = [3, 6];
		const first = await matka.handleEvent(paid());
		const again = await matka.handleEvent(paid());
		expect(first?.face).toBe(3);
		expect(again).toEqual(first);
		expect(store.rolls.size).toBe(1);
	});

	it('rolls for a bank payment that clears later, and not before', async () => {
		const { matka, store } = setup();
		faces = [2];
		expect(await matka.handleEvent(paid(SESSION, undefined, { payment_status: 'unpaid' }))).toBe(
			null
		);
		const roll = await matka.handleEvent(paid(SESSION, 'checkout.session.async_payment_succeeded'));
		expect(roll?.face).toBe(2);
		expect(store.rolls.size).toBe(1);
	});

	it('passes over other events, free orders and sessions without a payment', async () => {
		const { matka, store } = setup();
		expect(await matka.handleEvent(paid(SESSION, 'payment_intent.succeeded'))).toBe(null);
		expect(
			await matka.handleEvent(
				paid(SESSION, undefined, { payment_status: 'no_payment_required', payment_intent: null })
			)
		).toBe(null);
		expect(await matka.handleEvent(paid(SESSION, undefined, { payment_intent: null }))).toBe(null);
		expect(await matka.handleEvent(paid('not_a_session'))).toBe(null);
		expect(store.rolls.size).toBe(0);
	});

	it('takes an expanded payment intent', async () => {
		const { matka } = setup();
		const roll = await matka.handleEvent(paid(SESSION, undefined, { payment_intent: { id: PI } }));
		expect(roll?.paymentIntent).toBe(PI);
	});

	it('rolls with crypto.randomInt by default, 1 to 6', async () => {
		const store = memoryStore();
		const matka = createMatka({ stripe: fakeStripe().stripe, store, accepts: () => true });
		const seen = new Set<number>();
		for (let i = 0; i < 300; i++) seen.add((await matka.handleEvent(paid(`cs_test_${i}`)))!.face);
		expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it("passes over sessions that aren't this site's, and marks nothing", async () => {
		const { matka, store } = setup({
			accepts: async (session) => session.metadata?.shop === 'ours'
		});
		expect(await matka.handleEvent(paid(SESSION, undefined, { metadata: { shop: 'other' } }))).toBe(
			null
		);
		expect(
			await matka.handleEvent(
				paid(SESSION, undefined, { payment_status: 'no_payment_required', payment_intent: null })
			)
		).toBe(null);
		expect(store.rolls.size).toBe(0);
		expect(await matka.status(SESSION)).toEqual({ status: 'pending' });
		const roll = await matka.handleEvent(paid(SESSION, undefined, { metadata: { shop: 'ours' } }));
		expect(roll?.sessionId).toBe(SESSION);
	});

	it('refuses a bad config, and an rng out of range', async () => {
		expect(() => setup({ accepts: undefined })).toThrow(TypeError);
		expect(() => setup({ winningFace: 7 })).toThrow(RangeError);
		expect(() => setup({ sides: 1 })).toThrow(RangeError);
		const { matka } = setup();
		faces = [7];
		await expect(matka.handleEvent(paid())).rejects.toThrow(RangeError);
	});
});

describe('reveal', () => {
	it('is pending before the webhook arrives, and makes nothing', async () => {
		const { matka, store, create } = setup();
		expect(await matka.reveal(SESSION)).toEqual({ status: 'pending' });
		expect(store.rolls.size).toBe(0);
		faces = [6];
		await matka.handleEvent(paid());
		const result = await matka.reveal(SESSION);
		expect(result).toMatchObject({ status: 'rolled', face: 6, win: true, firstReveal: true });
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('never refunds a losing roll', async () => {
		const { matka, create } = setup();
		faces = [4];
		await matka.handleEvent(paid());
		expect(await matka.reveal(SESSION)).toEqual({
			status: 'rolled',
			face: 4,
			sides: 6,
			winningFace: 6,
			win: false,
			firstReveal: true,
			refund: 'none'
		});
		clock += 60_000;
		await matka.reveal(SESSION);
		expect(create).not.toHaveBeenCalled();
	});

	it('refunds a six in full, on its payment intent, once', async () => {
		const { matka, create } = setup();
		faces = [6];
		await matka.handleEvent(paid());
		expect(await matka.reveal(SESSION)).toMatchObject({ win: true, refund: 'issued' });
		expect(create).toHaveBeenCalledWith(
			{ payment_intent: PI, reason: 'requested_by_customer', metadata: { matka: SESSION } },
			{ idempotencyKey: `matka-refund:${SESSION}` }
		);
		// No amount: the whole charge.
		expect(create.mock.calls[0][0]).not.toHaveProperty('amount');
	});

	it('gives the same answer every time, and refunds once', async () => {
		const { matka, create, refunds } = setup();
		faces = [6];
		await matka.handleEvent(paid());
		const first = await matka.reveal(SESSION);
		clock += 60_000;
		const again = await matka.reveal(SESSION);
		expect(again).toEqual({ ...first, firstReveal: false });
		expect(create).toHaveBeenCalledTimes(1);
		expect(refunds).toHaveLength(1);
	});

	it('refunds once when ten reveals arrive at once', async () => {
		const { matka, create, refunds } = setup();
		faces = [6];
		await matka.handleEvent(paid());
		const results = await Promise.all(Array.from({ length: 10 }, () => matka.reveal(SESSION)));
		expect(new Set(results.map((r) => r.status === 'rolled' && r.face))).toEqual(new Set([6]));
		expect(results.filter((r) => r.status === 'rolled' && r.firstReveal)).toHaveLength(1);
		expect(create).toHaveBeenCalledTimes(1);
		expect(refunds).toHaveLength(1);
	});

	it('tries a failed refund again on a later reveal, and still refunds once', async () => {
		const { matka, create, refunds, fail } = setup();
		faces = [6];
		await matka.handleEvent(paid());
		fail.next = { message: 'Stripe is down' };
		expect(await matka.reveal(SESSION)).toMatchObject({ win: true, refund: 'pending' });
		// Soon after: left to the first call, which may still be going.
		clock += 5_000;
		expect(await matka.reveal(SESSION)).toMatchObject({ refund: 'pending' });
		expect(create).toHaveBeenCalledTimes(1);
		clock += 60_000;
		expect(await matka.reveal(SESSION)).toMatchObject({ refund: 'issued', firstReveal: false });
		clock += 60_000;
		await matka.reveal(SESSION);
		expect(create).toHaveBeenCalledTimes(2);
		expect(refunds).toHaveLength(1);
	});

	it('tries a refund that keeps failing once a lease, however often it is revealed', async () => {
		const { matka, list, create } = setup();
		faces = [6];
		await matka.handleEvent(paid());
		create.mockRejectedValue(Object.assign(new Error('disputed'), { code: 'charge_disputed' }));
		await matka.reveal(SESSION);
		expect(list).toHaveBeenCalledTimes(1);
		for (let i = 0; i < 3; i++) {
			clock += 31_000;
			// Twenty reveals at once: one of them tries again.
			await Promise.all(Array.from({ length: 20 }, () => matka.reveal(SESSION)));
			expect(list).toHaveBeenCalledTimes(2 + i);
			// And no more until the lease is over.
			clock += 10_000;
			await matka.reveal(SESSION);
			expect(list).toHaveBeenCalledTimes(2 + i);
		}
		expect(await matka.reveal(SESSION)).toMatchObject({ refund: 'pending' });
	});

	it("finds a refund it made but didn't record, rather than making another", async () => {
		const { matka, store, create, refunds } = setup();
		faces = [6];
		await matka.handleEvent(paid());
		// The refund went through, then the process died before writing it down.
		const recordRefund = store.recordRefund;
		store.recordRefund = async () => {
			throw new Error('crashed');
		};
		expect(await matka.reveal(SESSION)).toMatchObject({ refund: 'pending' });
		store.recordRefund = recordRefund;
		create.mockClear();
		clock += 60_000;
		expect(await matka.reveal(SESSION)).toMatchObject({ refund: 'issued' });
		expect(create).not.toHaveBeenCalled();
		expect(refunds).toHaveLength(1);
		expect((await store.get(SESSION))?.refundId).toBe(refunds[0].id);
	});

	it('takes an order already refunded by hand as refunded', async () => {
		const { matka, store, fail } = setup();
		faces = [6];
		await matka.handleEvent(paid());
		fail.next = { code: 'charge_already_refunded', message: 'already refunded' };
		expect(await matka.reveal(SESSION)).toMatchObject({ refund: 'issued' });
		expect((await store.get(SESSION))?.refundId).toBe(ALREADY_REFUNDED);
	});

	it("keeps each roll's winning face, whatever the config later says", async () => {
		const store = memoryStore();
		const { stripe } = fakeStripe();
		faces = [3];
		const accepts = () => true;
		await createMatka({
			stripe,
			store,
			accepts,
			winningFace: 3,
			rng: () => faces.shift()!
		}).handleEvent(paid());
		const later = createMatka({ stripe, store, accepts });
		expect(await later.reveal(SESSION)).toMatchObject({ face: 3, winningFace: 3, win: true });
	});

	it('refuses a malformed session id', async () => {
		const { matka } = setup();
		await expect(matka.reveal('cs_test_../../x')).rejects.toMatchObject({ status: 400 });
	});
});

describe('status', () => {
	it("doesn't reveal, and doesn't give the face away until it's revealed", async () => {
		const { matka, store } = setup();
		expect(await matka.status(SESSION)).toEqual({ status: 'pending' });
		faces = [6];
		await matka.handleEvent(paid());
		expect(await matka.status(SESSION)).toEqual({ status: 'ready', sides: 6, winningFace: 6 });
		expect((await store.get(SESSION))?.revealedAt).toBe(null);
		await matka.reveal(SESSION);
		expect(await matka.status(SESSION)).toMatchObject({ face: 6, firstReveal: false });
	});
});

describe('before the webhook', () => {
	it('is pending while a roll may be on its way: unknown, or a bank payment going through', async () => {
		const { matka } = setup();
		expect(await matka.status(SESSION)).toEqual({ status: 'pending' });
		await matka.handleEvent(
			paid(SESSION, undefined, { payment_status: 'unpaid', payment_intent: null })
		);
		expect(await matka.status(SESSION)).toEqual({ status: 'pending' });
		expect(await matka.reveal(SESSION)).toEqual({ status: 'pending' });
	});

	it('is none once the webhook says no roll is coming: £0, no payment, a failed bank payment', async () => {
		const { matka, store } = setup();
		const [free, subscription, failed] = ['cs_test_free', 'cs_test_sub', 'cs_test_failed'];
		await matka.handleEvent(
			paid(free, undefined, { payment_status: 'no_payment_required', payment_intent: null })
		);
		await matka.handleEvent(paid(subscription, undefined, { payment_intent: null }));
		await matka.handleEvent(
			paid(failed, undefined, { payment_status: 'unpaid', payment_intent: null })
		);
		expect(await matka.status(failed)).toEqual({ status: 'pending' });
		await matka.handleEvent(
			paid(failed, 'checkout.session.async_payment_failed', {
				payment_status: 'unpaid',
				payment_intent: null
			})
		);
		for (const id of [free, subscription, failed]) {
			expect(await matka.status(id)).toEqual({ status: 'none' });
			expect(await matka.reveal(id)).toEqual({ status: 'none' });
		}
		expect(store.rolls.size).toBe(0);
	});
});

describe('listUnrevealed', () => {
	it('lists the rolls nobody has revealed, oldest first', async () => {
		const { matka } = setup();
		await matka.handleEvent(paid('cs_test_b'));
		clock += 1000;
		await matka.handleEvent(paid('cs_test_a'));
		clock += 1000;
		await matka.handleEvent(paid('cs_test_c'));
		await matka.reveal('cs_test_c');
		expect((await matka.listUnrevealed()).map((r) => r.sessionId)).toEqual([
			'cs_test_b',
			'cs_test_a'
		]);
		const before = new Date(Date.parse('2026-10-25T12:00:00.500Z'));
		expect((await matka.listUnrevealed({ before })).map((r) => r.sessionId)).toEqual(['cs_test_b']);
	});
});

describe('handler', () => {
	const url = `https://shop.test/api/matka?session_id=${SESSION}`;

	it('GET is status, POST is reveal', async () => {
		const { matka, store } = setup();
		faces = [5];
		await matka.handleEvent(paid());
		const get = await matka.handler(new Request(url));
		expect(get.headers.get('cache-control')).toBe('no-store');
		expect(await get.json()).toEqual({ status: 'ready', sides: 6, winningFace: 6 });
		expect((await store.get(SESSION))?.revealedAt).toBe(null);
		const post = await matka.handler(new Request(url, { method: 'POST' }));
		expect(await post.json()).toMatchObject({ status: 'rolled', face: 5 });
	});

	it('answers 400 to a bad session id and 405 to other methods', async () => {
		const { matka } = setup();
		expect((await matka.handler(new Request('https://shop.test/api/matka'))).status).toBe(400);
		expect((await matka.handler(new Request(url, { method: 'PUT' }))).status).toBe(405);
	});

	it('answers 500 without detail when the store fails', async () => {
		const { matka, store } = setup();
		store.get = async () => {
			throw new Error('database password is hunter2');
		};
		const res = await matka.handler(new Request(url));
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain('hunter2');
	});
});
