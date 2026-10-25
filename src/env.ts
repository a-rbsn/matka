import { defineEnvVars } from '@sveltejs/kit/env';

/** The demo's settings (.env; see .env.example). None are needed for /playground. */
const optional = (v: string | undefined) => v || undefined;

export const variables = defineEnvVars({
	STRIPE_SECRET_KEY: { schema: optional, description: 'A Stripe test secret key (sk_test_…)' },
	STRIPE_WEBHOOK_SECRET: {
		schema: optional,
		description: 'The whsec_… `npm run stripe:listen` prints'
	},
	MATKA_STORE: {
		schema: (v) => {
			const store = v || 'memory';
			if (!['memory', 'blobs', 'supabase'].includes(store)) {
				throw new Error('MATKA_STORE: memory, blobs or supabase');
			}
			return store as 'memory' | 'blobs' | 'supabase';
		},
		description: 'Where rolls are kept: memory (default), blobs (a local Blobs server) or supabase'
	},
	MATKA_FORCE_FACE: {
		schema: (v) => {
			if (!v) return undefined;
			const face = Number(v);
			if (!Number.isInteger(face) || face < 1 || face > 6)
				throw new Error('MATKA_FORCE_FACE: 1 to 6');
			return face;
		},
		description: 'Every roll lands on this face (dev only), to try a win without six orders'
	},
	SUPABASE_URL: { schema: optional, description: 'For MATKA_STORE=supabase' },
	SUPABASE_SERVICE_ROLE_KEY: { schema: optional, description: 'For MATKA_STORE=supabase' }
});
