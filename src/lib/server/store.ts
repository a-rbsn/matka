/** One paid Checkout session's roll, decided when Stripe said it was paid. */
export interface Roll {
	/** The Checkout session (cs_…): one paid order, one roll. */
	sessionId: string;
	/** What a win refunds. */
	paymentIntent: string;
	face: number;
	sides: number;
	/** Kept with the roll, so changing the config later can't change an old outcome. */
	winningFace: number;
	/** ISO 8601. */
	createdAt: string;
	revealedAt: string | null;
	/** When a refund was last tried after the first (the first is at revealedAt). */
	refundTriedAt: string | null;
	/** The Stripe refund (re_…) once a win's refunded; ALREADY_REFUNDED if it was refunded by hand. */
	refundId: string | null;
}

/**
 * Whether a refund can be tried again: a revealed win with no refund recorded, whose last try
 * (refundTriedAt, or revealedAt for the first) was before `staleBefore`.
 */
export const refundIsStale = (roll: Roll, staleBefore: string) =>
	!!roll.revealedAt &&
	!roll.refundId &&
	Date.parse(roll.refundTriedAt ?? roll.revealedAt) < Date.parse(staleBefore);

/** A revealed win with no refund recorded: its refund failed (or is being made right now). */
export const isUnrefunded = (roll: Roll) =>
	roll.face === roll.winningFace && !!roll.revealedAt && !roll.refundId;

/** A win whose charge was already fully refunded (by hand, say) when it was revealed. */
export const ALREADY_REFUNDED = 'already_refunded';

/**
 * Where rolls are kept. Each write must be atomic: these are what stop a duplicate webhook rolling
 * twice and a double click refunding twice.
 */
export interface MatkaStore {
	/** Saves the roll unless its session has one already; returns whichever is stored. */
	create(roll: Roll): Promise<Roll>;
	get(sessionId: string): Promise<Roll | null>;
	/**
	 * Sets revealedAt if it's unset. `first` is true only for the call that set it. Null if the
	 * session has no roll.
	 */
	markRevealed(sessionId: string, at: string): Promise<{ roll: Roll; first: boolean } | null>;
	/**
	 * Sets refundTriedAt to `at` if refundIsStale(roll, staleBefore). True only for the call that
	 * set it, so a refund that keeps failing is tried by one caller at a time.
	 */
	claimRefund(sessionId: string, at: string, staleBefore: string): Promise<boolean>;
	/** Sets refundId if it's unset; returns the stored roll. */
	recordRefund(sessionId: string, refundId: string): Promise<Roll>;
	/** Rolls nobody has revealed, oldest first; `before` (ISO 8601) leaves out newer ones. */
	listUnrevealed(options?: { before?: string }): Promise<Roll[]>;
	/** Rolls that are isUnrefunded, oldest first. */
	listUnrefunded(): Promise<Roll[]>;
	/**
	 * Records that a session will never have a roll (£0, no payment, a bank payment that failed),
	 * so the endpoint can answer "none" without asking Stripe.
	 */
	markNone(sessionId: string, at: string): Promise<void>;
	/** Whether markNone was called for the session. */
	isNone(sessionId: string): Promise<boolean>;
}
