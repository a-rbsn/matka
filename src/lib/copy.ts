/** What a roll's words are given. */
export interface CopyContext {
	face: number;
	sides: number;
	winningFace: number;
}

/** Everything <Matka> says. Pass any of it to change it. */
export interface Copy {
	/** Above the die. */
	intro: (c: Omit<CopyContext, 'face'>) => string;
	button: string;
	rolling: string;
	/** Paid, but the roll isn't made yet (Stripe's webhook is on its way). */
	pending: string;
	/** Still pending after half a minute. */
	late: string;
	checkAgain: string;
	error: string;
	tryAgain: string;
	win: (c: CopyContext) => string;
	lose: (c: CopyContext) => string;
}

const WORDS = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten',
	'eleven',
	'twelve'
];

/** "a six", "an eight", "a 20". */
export function aFace(n: number): string {
	const word = WORDS[n] ?? String(n);
	return `${/^(eight|eleven)$/.test(word) ? 'an' : 'a'} ${word}`;
}

export const defaultCopy: Copy = {
	intro: ({ winningFace }) => `Roll ${aFace(winningFace)} and your order's on us.`,
	button: 'Roll the die',
	rolling: 'Rolling…',
	pending: 'Getting your die ready…',
	late: "Your die isn't ready yet. It can take a minute after paying.",
	checkAgain: 'Check again',
	error: "Something went wrong. Your roll is safe: it's already decided, so try again.",
	tryAgain: 'Try again',
	win: ({ winningFace }) =>
		`You rolled ${aFace(winningFace)}! Your order's on us: a full refund is on its way to your card, and your order still ships.`,
	lose: ({ face }) => `You rolled ${aFace(face)}. Not this time, but your order is on its way.`
};
