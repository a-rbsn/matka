import { error } from '@sveltejs/kit';
import { matka } from '../../../demo/matka.server.js';

/** <Matka>'s endpoint: GET looks, POST reveals. */
const handle = ({ request }: { request: Request }) => {
	if (!matka) error(500, 'Set STRIPE_SECRET_KEY in .env');
	return matka.handler(request);
};

export const GET = handle;
export const POST = handle;
