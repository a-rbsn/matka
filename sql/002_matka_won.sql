-- @andrewrip/matka 0.2.0: for listUnrefunded (and sweep). Run after 001_matka_rolls.sql.

-- Whether the roll's a win: PostgREST can't compare two columns in a filter.
alter table public.matka_rolls
  add column won boolean generated always as (face = winning_face) stored;

-- listUnrefunded: only revealed wins with no refund recorded, oldest first.
create index matka_rolls_unrefunded on public.matka_rolls (created_at)
  where won and revealed_at is not null and refund_id is null;
