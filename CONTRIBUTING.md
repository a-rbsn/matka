# Contributing

Thanks for helping. Bug reports, fixes and new themes are all welcome. For anything bigger than
a fix, open an issue first so we can agree on the approach.

If you've found a security problem, please don't open an issue: see [SECURITY.md](SECURITY.md).

## Set up

```sh
git clone https://github.com/a-rbsn/matka.git
cd matka
npm install
```

You need Node 20 or later. To try a real checkout you also need the
[Stripe CLI](https://docs.stripe.com/stripe-cli) and a Stripe account in test mode.

## Project layout

```
src/lib/                 the package (what's published, built into dist/)
  Matka.svelte           the component
  FlatDie.svelte         the default theme
  server/                createMatka and the stores
  themes/dice3d/         the 3D dice
sql/                     the Supabase / Postgres schema (published too)
src/routes/, src/demo/   the demo shop and the playground (not published)
```

## The playground

```sh
npm run dev
```

Open http://localhost:5173/playground. It runs the real `<Matka>` against a pretend checkout,
with no Stripe account needed. You can pick the face and the theme, and turn slow motion and
the pause on and off.

## The demo shop

The demo is a one-product shop that runs a real test-mode Stripe Checkout.

```sh
cp .env.example .env          # add a Stripe test secret key (sk_test_…)
npm run stripe:listen         # prints the whsec_… to put in .env (it stays the same)
npm run dev                   # http://localhost:5173
```

1. Buy a £1 test print with the card `4242 4242 4242 4242`. You land on `/thanks` with the die.
2. `MATKA_FORCE_FACE=6 npm run dev` makes every roll a six, so you can try a win. It only works
   in development.
3. To make a paid session without the browser, run
   `stripe trigger checkout.session.completed --add checkout_session:metadata.matka_demo=1`, then
   open `/thanks?session_id=<the cs_… the dev server logs>`.
4. `MATKA_STORE=blobs` keeps rolls in a local Netlify Blobs server under `.netlify/matka-blobs`.
   `MATKA_STORE=supabase` uses a local Supabase (`supabase start`, on port 55321, with the tables
   made from `sql/`).

The demo refuses to start with a live key.

## Tests

```sh
npm test
```

The Supabase store's tests run against a local Supabase when these are set:

```sh
supabase start
MATKA_TEST_SUPABASE_URL=http://127.0.0.1:55321 MATKA_TEST_SUPABASE_KEY=<the secret key it prints> npm test
```

The tests cover:

- **Server logic:** duplicate webhooks, a reveal before the webhook, concurrent reveals (one
  refund), refunds only on a win, retrying a failed refund (once a lease), finding an unrecorded
  refund, orders refunded by hand, and sessions that aren't this site's.
- **Stores:** one shared set of tests, run against every store.
- **`<Matka>`:** reduced motion, the result announced, revisits, waiting for the webhook,
  timeouts.
- **Dice3D:** the 24 orientations of a real die and the remap, and that throws settle flat.

Before opening a pull request, run:

```sh
npm run check    # types
npm run lint     # formatting (npm run format fixes it)
npm test
npm run build    # also checks that no server code reaches the client bundle
```

## Trying a local build in another project

Install it as a copy, not a link:

```sh
npm run package                        # here, after each change
rm -rf node_modules/@andrewrip/matka   # there: npm keeps the old copy while the version is unchanged
npm install --install-links ../matka
```

A link (`npm link`, or `file:` without `--install-links`) breaks on Netlify Functions, which copy
`node_modules` into their own folder, where a relative symlink points nowhere. With a copy or a
link, the other project's `vite.config.ts` needs `resolve: { dedupe: ['svelte', 'three'] }`, so it
doesn't end up with two copies of Svelte or three.

## Releasing

For maintainers:

1. Add the changes to [CHANGELOG.md](CHANGELOG.md).
2. Run `npm version patch` (or `minor`, `major`).
3. Run `npm publish`. `prepublishOnly` type-checks, runs the tests, builds, and runs publint and
   are-the-types-wrong.
4. Push the commit and the tag: `git push --follow-tags`.
