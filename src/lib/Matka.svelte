<!--
	@component
	The roll, after paying: the button, the die (a theme draws it), and what it means. The outcome
	comes from the server (`endpoint`, matka.handler); this only reveals it. For a session with no
	roll coming (a £0 order), or no session at all, it shows nothing.

	```svelte
	<Matka sessionId={page.url.searchParams.get('session_id')} theme={MyDie} />
	```
-->
<script lang="ts">
	import { tick, type Component } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { defaultCopy, type Copy } from './copy.js';
	import FlatDie from './FlatDie.svelte';
	import type { MatkaReveal, MatkaStatus, Phase, Rolled, ThemeProps } from './types.js';

	interface Props {
		/**
		 * The Checkout session (cs_…), from the success URL's {CHECKOUT_SESSION_ID}. Without one, it
		 * shows nothing.
		 */
		sessionId: string | null | undefined;
		/** Where matka.handler is served. */
		endpoint?: string;
		/** Draws the die. Default: a flat one. */
		theme?: Component<ThemeProps>;
		/** More props for the theme (Dice3D's colours, say). */
		themeProps?: Record<string, unknown>;
		copy?: Partial<Copy>;
		/** A beat of stillness after it lands, before the verdict. */
		pause?: boolean;
		/**
		 * Show the words for a loss. Off, a loss is only said to screen readers: the die says it
		 * all. A win's words always show (they explain the refund).
		 */
		showLoss?: boolean;
		/** Once the result's shown (after the animation; at once on a revisit). */
		onresult?: (result: Rolled) => void;
	}

	let {
		sessionId,
		endpoint = '/api/matka',
		theme,
		themeProps = {},
		copy,
		pause = true,
		showLoss = true,
		onresult
	}: Props = $props();

	/** How often to ask while the webhook's on its way, and for how long. */
	const POLL_MS = 2000;
	const POLL_FOR_MS = 30_000;
	/** A theme that never calls onlanded is skipped after this. */
	const LANDING_TIMEOUT_MS = 10_000;
	/** The beat between landing and the verdict. */
	const PAUSE_MS = 700;

	type Step =
		| 'loading'
		| 'pending'
		| 'late'
		| 'ready'
		| 'revealing'
		| 'rolling'
		| 'settling'
		| 'landed'
		| 'error'
		| 'none';

	let step = $state<Step>('loading');
	let sides = $state(6);
	let winningFace = $state(6);
	let result = $state<Rolled | null>(null);
	/** Move focus to the result when it lands: only after a roll here, not on a revisit. */
	let rolledHere = $state(false);
	let message: HTMLElement | undefined = $state();

	const words = $derived({ ...defaultCopy, ...copy });
	const Theme = $derived(theme ?? FlatDie);
	const phase: Phase = $derived(
		step === 'rolling' ? 'rolling' : step === 'settling' || step === 'landed' ? 'landed' : 'waiting'
	);

	function url() {
		const u = new URL(endpoint, location.href);
		// Only asked with a session (see the $effect below).
		u.searchParams.set('session_id', sessionId!);
		return u;
	}

	async function ask(method: 'GET' | 'POST'): Promise<MatkaStatus> {
		const res = await fetch(url(), { method, headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`[matka] ${method} ${res.status}`);
		return res.json();
	}

	function show(r: Rolled) {
		result = r;
		sides = r.sides;
		winningFace = r.winningFace;
	}

	let polling: ReturnType<typeof setTimeout> | undefined;

	async function load(until = Date.now() + POLL_FOR_MS) {
		clearTimeout(polling);
		try {
			const s = await ask('GET');
			if (s.status === 'none') step = 'none';
			else if (s.status === 'pending') {
				if (Date.now() >= until) step = 'late';
				else {
					step = 'pending';
					polling = setTimeout(() => load(until), POLL_MS);
				}
			} else if (s.status === 'ready') {
				sides = s.sides;
				winningFace = s.winningFace;
				step = 'ready';
			} else {
				show(s);
				land();
			}
		} catch (e) {
			console.error(e);
			step = 'error';
		}
	}

	let timer: ReturnType<typeof setTimeout> | undefined;

	async function roll() {
		if (step !== 'ready') return;
		step = 'revealing';
		try {
			const r = (await ask('POST')) as MatkaReveal;
			if (r.status === 'pending') return load();
			if (r.status === 'none') {
				step = 'none';
				return;
			}
			show(r);
			rolledHere = true;
			if (prefersReducedMotion.current) settle();
			else {
				step = 'rolling';
				timer = setTimeout(landed, LANDING_TIMEOUT_MS);
			}
		} catch (e) {
			console.error(e);
			step = 'error';
		}
	}

	/** The theme's onlanded. */
	function landed() {
		clearTimeout(timer);
		if (step === 'rolling') settle();
	}

	/** Still: the verdict after a beat (only after a roll here). */
	function settle() {
		if (!pause) return land();
		step = 'settling';
		timer = setTimeout(land, PAUSE_MS);
	}

	async function land() {
		step = 'landed';
		onresult?.(result!);
		await tick();
		if (rolledHere) message?.focus();
	}

	function retry() {
		// After a failed reveal, the roll may or may not be revealed: asking again finds out.
		step = 'loading';
		load();
	}

	$effect(() => {
		endpoint;
		if (!sessionId) {
			step = 'none';
			return;
		}
		load();
		return () => {
			clearTimeout(polling);
			clearTimeout(timer);
		};
	});
</script>

{#if step !== 'none'}
	<section
		class="matka"
		data-step={step}
		aria-busy={['loading', 'revealing', 'rolling', 'settling'].includes(step)}
	>
		<!-- Above the die, and kept once it's thrown, so the die doesn't move under the throw. -->
		{#if ['ready', 'revealing', 'rolling', 'settling', 'landed'].includes(step)}
			<p class="matka-intro">{words.intro({ sides, winningFace })}</p>
		{/if}

		<div class="matka-stage" aria-hidden="true">
			<Theme
				{...themeProps}
				{phase}
				face={result?.face ?? null}
				{sides}
				onlanded={landed}
				win={step === 'landed' ? (result?.win ?? null) : null}
			/>
		</div>

		<!-- Once pressed, kept (hidden, disabled) until it lands, so nothing moves under the die. -->
		{#if ['ready', 'revealing', 'rolling', 'settling'].includes(step)}
			<button type="button" class="matka-button" onclick={roll} aria-disabled={step !== 'ready'}>
				{step === 'ready' ? words.button : words.rolling}
			</button>
		{:else if step === 'late'}
			<button type="button" class="matka-button" onclick={retry}>{words.checkAgain}</button>
		{:else if step === 'error'}
			<button type="button" class="matka-button" onclick={retry}>{words.tryAgain}</button>
		{/if}

		<!-- Always in the page, so screen readers hear each change. -->
		<p class="matka-message" role="status" tabindex="-1" bind:this={message}>
			{#if step === 'pending'}
				{words.pending}
			{:else if step === 'late'}
				{words.late}
			{:else if step === 'error'}
				{words.error}
			{:else if step === 'rolling'}
				<!-- The button says so; this is for screen readers. -->
				<span class="matka-hidden">{words.rolling}</span>
			{:else if step === 'landed' && result?.win}
				{words.win(result)}
			{:else if step === 'landed' && result}
				<span class={showLoss ? undefined : 'matka-hidden'}>{words.lose(result)}</span>
			{/if}
		</p>
	</section>
{/if}

<style>
	/* :where() keeps these at no specificity, so a host's own styles always win. */
	:where(.matka) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;
	}
	:where(.matka-stage) {
		width: var(--matka-size, min(20rem, 100%));
		aspect-ratio: 1;
	}
	:where(.matka-intro, .matka-message) {
		margin: 0;
		max-width: 32rem;
		text-wrap: balance;
	}
	.matka-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	:where(.matka-message):focus {
		outline: none;
	}
	:where(.matka-button) {
		font: inherit;
		padding: 0.75em 1.5em;
		cursor: pointer;
	}
	:where(.matka-button[aria-disabled='true']) {
		cursor: progress;
	}
	:where(
		.matka:is([data-step='revealing'], [data-step='rolling'], [data-step='settling']) .matka-button
	) {
		visibility: hidden;
	}
</style>
