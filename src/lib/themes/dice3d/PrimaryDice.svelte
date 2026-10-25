<!--
	@component
	A theme for <Matka>: Dice3D with a flat finish (unlit, every side one bright colour) in two
	primary colours, different each throw: one for the die, one for its pips.

	```svelte
	<Matka {sessionId} theme={PrimaryDice} />
	```
-->
<script lang="ts">
	import type { Phase, ThemeProps } from '../../types.js';
	import { pickTwo, PRIMARIES } from './colours.js';
	import Dice3D from './Dice3D.svelte';
	import type { Dance } from './scene.js';

	interface Props extends ThemeProps {
		/** The colours it chooses two from. */
		palette?: string[];
		/** Slow motion round the die's last topple. */
		slowmo?: boolean;
		/** On a win, a dance about the window: hop, walk or false. */
		dance?: Dance | false;
		landing?: 'stage' | 'anywhere';
	}

	let {
		phase,
		face,
		sides,
		onlanded,
		win,
		palette = PRIMARIES,
		slowmo = true,
		dance = 'hop',
		landing = 'stage'
	}: Props = $props();

	const pick = () => pickTwo(palette);

	let colours = $state(pick());
	let was: Phase = 'waiting';

	// New colours as each throw starts (it starts off the window, so the change isn't seen).
	$effect.pre(() => {
		if (phase === 'rolling' && was !== 'rolling') colours = pick();
		was = phase;
	});
</script>

<Dice3D
	{phase}
	{face}
	{sides}
	{onlanded}
	{win}
	{slowmo}
	{dance}
	{landing}
	finish="flat"
	color={colours[0]}
	pipColor={colours[1]}
/>
