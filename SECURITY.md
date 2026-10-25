# Security

Matka issues refunds, so security problems matter. Examples include a way to roll more than once
for an order, choose or learn a roll before it's revealed, trigger a refund that wasn't won, or
use the endpoint to make Stripe API calls.

## Reporting a problem

Please don't open a public issue. Report it privately through GitHub instead: on the
repository's **Security** tab, choose **Report a vulnerability**. Include what you found and how
to reproduce it.

## Supported versions

Only the latest release gets fixes.

## What Matka relies on you for

- Verifying the Stripe webhook's signature before calling `handleEvent`.
- An `accepts` check that only accepts your own site's Checkout sessions.
- Keeping `createMatka`, your Stripe key and your store's credentials on the server.
- A store whose writes are atomic (the built-in Netlify Blobs and Supabase stores are).
