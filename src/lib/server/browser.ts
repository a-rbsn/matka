// What a browser bundle gets for @andrewrip/matka/server (its "browser" export condition): the
// server code, and the Stripe client given to it, must never be sent to the browser.
throw new Error(
	'@andrewrip/matka/server was imported in browser code. Import it only on the server (a ' +
		'+server.ts, +page.server.ts, hooks.server.ts or a serverless function).'
);
