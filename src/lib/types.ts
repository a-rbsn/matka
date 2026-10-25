/**
 * Types shared by the browser and the server: what the endpoint answers, and what a theme is
 * given. Nothing here imports anything, so it's safe on both sides.
 */

/** Where the die is: not yet thrown, in the air, or at rest on its face. */
export type Phase = 'waiting' | 'rolling' | 'landed';

/** Whether a winning roll's refund has gone through. */
export type RefundState = 'none' | 'issued' | 'pending';

/** The webhook hasn't arrived yet, so there's no roll to show. */
export interface Pending {
	status: 'pending';
}

/** No roll is coming: the session wasn't paid, or cost nothing (a £0 order), or doesn't exist. */
export interface NoRoll {
	status: 'none';
}

/** Rolled (on the server) but not revealed. The face isn't sent until it is. */
export interface Ready {
	status: 'ready';
	sides: number;
	winningFace: number;
}

/** Revealed: the face, and what it means. */
export interface Rolled {
	status: 'rolled';
	face: number;
	sides: number;
	winningFace: number;
	win: boolean;
	/** True only for the reveal() call that revealed it; a revisit gets false. */
	firstReveal: boolean;
	refund: RefundState;
}

export type MatkaStatus = Pending | NoRoll | Ready | Rolled;
export type MatkaReveal = Pending | NoRoll | Rolled;

/** The props <Matka> gives a theme. A theme only draws; <Matka> owns everything else. */
export interface ThemeProps {
	phase: Phase;
	/** The face to land on: null while waiting, set from the moment the roll starts. */
	face: number | null;
	sides: number;
	/** Call once the rolling animation has come to rest (not in the landed phase). */
	onlanded: () => void;
	/**
	 * Once the result's shown (after any pause before the verdict): whether it won. Null until
	 * then, so a theme can celebrate without giving the result away early.
	 */
	win: boolean | null;
}
