-- @andrewrip/matka: one roll per paid Checkout session, and the sessions that won't have one.
--
-- The rules the package relies on, enforced here as well:
--   one paid order, one roll      session_id is the primary key
--   a roll never changes          the trigger refuses changes to anything but revealed_at and
--                                 refund_id, and refuses changing either once it's set
--   no refund before the reveal   matka_rolls_refund_after_reveal
--
-- Only the server reads or writes them, with the service role key: row level security is on with
-- no policies, and the API roles' grants are revoked.

create table public.matka_rolls (
  session_id text primary key,
  payment_intent text not null,
  face smallint not null,
  sides smallint not null,
  winning_face smallint not null,
  created_at timestamptz not null default now(),
  revealed_at timestamptz,
  -- When a failed refund was last tried again (the first try is at revealed_at).
  refund_tried_at timestamptz,
  refund_id text,
  constraint matka_rolls_session_id check (session_id ~ '^cs_(test|live)_[A-Za-z0-9]+$'),
  constraint matka_rolls_sides check (sides >= 2),
  constraint matka_rolls_face check (face between 1 and sides),
  constraint matka_rolls_winning_face check (winning_face between 1 and sides),
  constraint matka_rolls_refund_after_reveal check (refund_id is null or revealed_at is not null),
  constraint matka_rolls_retry_after_reveal check (refund_tried_at is null or revealed_at is not null)
);

-- listUnrevealed: only the rows not yet revealed, oldest first.
create index matka_rolls_unrevealed on public.matka_rolls (created_at) where revealed_at is null;

create function public.matka_rolls_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.session_id, new.payment_intent, new.face, new.sides, new.winning_face, new.created_at)
     is distinct from
     (old.session_id, old.payment_intent, old.face, old.sides, old.winning_face, old.created_at) then
    raise exception 'matka: a roll can''t be changed';
  end if;
  if old.revealed_at is not null and new.revealed_at is distinct from old.revealed_at then
    raise exception 'matka: revealed_at is already set';
  end if;
  if old.refund_id is not null and new.refund_id is distinct from old.refund_id then
    raise exception 'matka: refund_id is already set';
  end if;
  return new;
end;
$$;

create trigger matka_rolls_guard
  before update on public.matka_rolls
  for each row execute function public.matka_rolls_guard();

alter table public.matka_rolls enable row level security;
revoke all on table public.matka_rolls from anon, authenticated;

-- Sessions that will never have a roll (£0, no payment, a bank payment that failed), so the
-- endpoint can answer "none" without asking Stripe.
create table public.matka_none (
  session_id text primary key,
  created_at timestamptz not null default now(),
  constraint matka_none_session_id check (session_id ~ '^cs_(test|live)_[A-Za-z0-9]+$')
);

alter table public.matka_none enable row level security;
revoke all on table public.matka_none from anon, authenticated;
