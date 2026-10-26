# Changelog

## 0.2.0

- `sweep({ before })`: for a daily job. It reveals the rolls nobody has revealed by `before`, so
  a six is refunded even if the customer never saw the thanks page, and tries again any refund
  that failed. See step 6 of the README.
- `listUnrefunded()`: revealed wins whose refund hasn't gone through.
- **Your own store:** `MatkaStore` needs a new method, `listUnrefunded()`.
- **Supabase:** run `sql/002_matka_won.sql`. It adds a `won` column and an index for
  `listUnrefunded()`.
- **Netlify Blobs:** wins are now indexed under `won/`. Wins rolled with 0.1.0 aren't in the
  index, so `sweep()` won't retry their refunds (it still reveals them).

## 0.1.0

The first release.

- `createMatka`: a roll for each paid Checkout session, made in your Stripe webhook and revealed
  on your thanks page, with a full refund on a six.
- Stores for Netlify Blobs and Supabase, and a memory store for tests.
- `<Matka>`, with the flat SVG die as its default theme.
- `<Dice3D>` and `<PrimaryDice>`: 3D dice with three and cannon-es.
