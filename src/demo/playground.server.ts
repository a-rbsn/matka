import { randomInt } from 'node:crypto';
import { createMatka, type MatkaStore } from '../lib/server/index.js';
import { memoryStore } from '../lib/server/memory.js';

/**
 * The playground's Matka: the real one, with a Stripe that refunds nothing and rolls made on
 * request (no checkout), so <Matka> can be tried over and over. Demo only.
 */

const g = globalThis as { matkaPlaygroundStore?: MatkaStore };
const store = (g.matkaPlaygroundStore ??= memoryStore());

/** The face the next roll lands on (0: random). */
let next = 0;

export const playground = createMatka({
	stripe: {
		refunds: {
			create: async () => ({ id: 're_playground' }),
			list: async () => ({ data: [] })
		}
	},
	store,
	accepts: () => true,
	rng: (sides) => next || randomInt(1, sides + 1)
});

export const isPlaygroundSession = (id: string | null): id is string =>
	!!id && /^cs_test_play[A-Za-z0-9]{1,40}$/.test(id);

/** Rolls for a playground session, as a paid checkout would (once: later calls change nothing). */
export async function rollFor(sessionId: string, face: number) {
	next = Number.isInteger(face) && face >= 1 && face <= 6 ? face : 0;
	try {
		await playground.handleEvent({
			type: 'checkout.session.completed',
			data: {
				object: {
					object: 'checkout.session',
					id: sessionId,
					payment_status: 'paid',
					payment_intent: 'pi_playground'
				}
			}
		});
	} finally {
		next = 0;
	}
}
