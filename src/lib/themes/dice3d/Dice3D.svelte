<!--
	@component
	A theme for <Matka>: a real die, thrown in from beyond the edge of the window, across the page,
	bouncing and tumbling until it settles in the stage on the server's face. The throw is
	simulated (cannon-es) before it's shown; whichever side ends up on top is given the server's
	number, so the physics is never steered. While it's moving it's drawn over the whole page
	(clicks pass through).

	three and cannon-es load when it mounts (not with the page), while the die waits to be rolled.
	Without WebGL, or for a die that isn't a d6, it draws <FlatDie> instead.

	```svelte
	<Matka {sessionId} theme={Dice3D} />
	```
	For other colours, pass them through <Matka>'s themeProps:
	`themeProps={{ color: '#111', pipColor: '#fff', finish: 'flat' }}`. Changing them repaints the
	die in place.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import FlatDie from '../../FlatDie.svelte';
	import type { ThemeProps } from '../../types.js';
	import type { Dance, DieScene } from './scene.js';

	interface Props extends ThemeProps {
		/** The die's colour. */
		color?: string;
		/** The pips' colour. */
		pipColor?: string;
		/** glossy (soft light, reflections) or flat (unlit, every side one bright colour). */
		finish?: 'glossy' | 'flat';
		/** Slow motion round the die's last topple. */
		slowmo?: boolean;
		/**
		 * Where it comes to rest: the stage, or (experimental) anywhere in the window, staying there
		 * over the page until the window's resized.
		 */
		landing?: 'stage' | 'anywhere';
		/**
		 * On a win, a dance about the window, on and on (still with reduced motion): hop (a random
		 * way each time, nearly tipping over as it lands), walk (small hops along a wandering,
		 * curving path) or false.
		 */
		dance?: Dance | false;
	}

	let {
		phase,
		face,
		sides,
		onlanded,
		win,
		color = '#f6f1e7',
		pipColor = '#1f1b16',
		finish = 'glossy',
		slowmo = true,
		landing = 'stage',
		dance = 'hop'
	}: Props = $props();

	let host: HTMLDivElement | undefined = $state();
	let die: DieScene | undefined = $state.raw();
	let failed = $state(false);

	$effect(() => {
		if (!host) return;
		if (sides !== 6) {
			console.warn('[matka] Dice3D draws a d6: showing FlatDie for', sides, 'sides');
			failed = true;
			return;
		}
		let gone = false;
		let made: DieScene | undefined;
		const look = {
			color: untrack(() => color),
			pipColor: untrack(() => pipColor),
			finish,
			landing
		};
		import('./scene.js')
			.then(({ createScene }) => {
				if (gone || !host) return;
				made = die = createScene(host, look);
			})
			.catch((e) => {
				console.error('[matka] no 3D die:', e);
				failed = true;
			});
		return () => {
			gone = true;
			made?.dispose();
			die = undefined;
		};
	});

	$effect(() => {
		die?.paint(color, pipColor);
	});

	$effect(() => {
		if (!die) return;
		if (phase === 'waiting') die.rest(6);
		else if (phase === 'rolling' && face)
			die.roll(
				face,
				onlanded,
				untrack(() => slowmo)
			);
		else if (phase === 'landed' && face) die.land(face);
	});

	$effect(() => {
		die?.dance(phase === 'landed' && win === true && !prefersReducedMotion.current && dance);
	});
</script>

{#if failed}
	<FlatDie {phase} {face} {sides} {onlanded} {win} />
{:else}
	<div class="dice3d" bind:this={host}></div>
{/if}

<style>
	.dice3d {
		width: 100%;
		height: 100%;
	}
</style>
