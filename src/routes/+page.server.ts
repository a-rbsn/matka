import { error, redirect } from '@sveltejs/kit';
import { MATKA_STORE, STRIPE_WEBHOOK_SECRET } from '$app/env/private';
import { stripe } from '../demo/matka.server.js';

export const load = () => ({
	stripe: !!stripe,
	webhook: !!STRIPE_WEBHOOK_SECRET,
	store: MATKA_STORE
});

export const actions = {
	/** A £1 test order, as a shop's checkout would make it. */
	default: async ({ url }) => {
		if (!stripe) error(500, 'Set STRIPE_SECRET_KEY in .env');
		const session = await stripe.checkout.sessions.create({
			mode: 'payment',
			line_items: [
				{
					quantity: 1,
					price_data: {
						currency: 'gbp',
						unit_amount: 100,
						product_data: { name: 'A test print' }
					}
				}
			],
			// How this site's webhook knows the session is its own (the Stripe account may have others).
			metadata: { matka_demo: '1' },
			success_url: `${url.origin}/thanks?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: url.origin
		});
		redirect(303, session.url!, { external: ['https://checkout.stripe.com'] });
	}
};
