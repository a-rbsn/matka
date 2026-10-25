import { STRIPE_WEBHOOK_SECRET } from '$app/env/private';
import type Stripe from 'stripe';
import { matka, stripe } from '../../../demo/matka.server.js';

/**
 * The host site's own Stripe webhook (Matka doesn't have one): it checks the signature, does
 * whatever else the site does with a paid order, and hands the event to matka.handleEvent.
 */
export async function POST({ request }) {
	if (!stripe || !matka || !STRIPE_WEBHOOK_SECRET) return new Response(null, { status: 500 });
	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(
			await request.text(),
			request.headers.get('stripe-signature') ?? '',
			STRIPE_WEBHOOK_SECRET
		);
	} catch (e) {
		console.warn('[webhook] not from Stripe:', (e as Error).message);
		return new Response(null, { status: 400 });
	}
	try {
		const roll = await matka.handleEvent(event);
		if (roll) console.info('[webhook] rolled for', roll.sessionId);
	} catch (e) {
		console.error('[webhook]', e);
		// Stripe tries again.
		return new Response(null, { status: 500 });
	}
	return new Response(null, { status: 200 });
}
