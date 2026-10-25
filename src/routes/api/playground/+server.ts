import { error } from '@sveltejs/kit';
import { isPlaygroundSession, playground, rollFor } from '../../../demo/playground.server.js';

/** The playground's endpoint: matka.handler, with the roll made on first look (`&face=`). */
async function handle({ request, url }: { request: Request; url: URL }) {
	const sessionId = url.searchParams.get('session_id');
	if (!isPlaygroundSession(sessionId)) error(400, 'not a playground session');
	if (request.method === 'GET') await rollFor(sessionId, Number(url.searchParams.get('face')));
	return playground.handler(request);
}

export const GET = handle;
export const POST = handle;
