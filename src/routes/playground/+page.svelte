<script lang="ts">
	import { FlatDie, Matka } from '../../lib/index.js';
	import { Dice3D, PrimaryDice } from '../../lib/themes/dice3d/index.js';

	/**
	 * The real <Matka>, against a pretend checkout (/api/playground): roll as often as you like,
	 * choose the face, and switch each bit of anticipation on and off.
	 */
	const themes = { Dice3D, PrimaryDice, FlatDie };
	let name = $state<keyof typeof themes>('Dice3D');
	let face = $state(0);
	let slowmo = $state(true);
	let pause = $state(true);
	let anywhere = $state(false);
	let dance = $state<'hop' | 'walk' | false>('hop');

	const fresh = () => `cs_test_play${Math.random().toString(36).slice(2, 12)}`;
	let sessionId = $state(fresh());
	const again = () => (sessionId = fresh());
</script>

<svelte:head><title>Playground · Matka demo</title></svelte:head>

<h1>Playground</h1>

<fieldset>
	<legend>Anticipation</legend>
	<label>
		<input type="checkbox" bind:checked={slowmo} disabled={name === 'FlatDie'} /> Slow-mo last topple
	</label>
	<label><input type="checkbox" bind:checked={pause} /> Pause before verdict</label>
	<label>
		<input type="checkbox" bind:checked={anywhere} disabled={name === 'FlatDie'} /> Land anywhere
	</label>
</fieldset>

<div class="controls">
	<label>
		Theme
		<select bind:value={name}>
			{#each Object.keys(themes) as t (t)}<option>{t}</option>{/each}
		</select>
	</label>
	<label>
		Land on
		<select bind:value={face} onchange={again}>
			<option value={0}>random</option>
			{#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={n}>{n}</option>{/each}
		</select>
	</label>
	<label>
		Dance on a six
		<select bind:value={dance} disabled={name === 'FlatDie'}>
			<option value="hop">hop</option>
			<option value="walk">walk</option>
			<option value={false}>off</option>
		</select>
	</label>
	<button type="button" onclick={again}>New roll</button>
</div>

{#key sessionId}
	<Matka
		{sessionId}
		endpoint="/api/playground?face={face}"
		theme={themes[name]}
		themeProps={{ slowmo, landing: anywhere ? 'anywhere' : 'stage', dance }}
		{pause}
	/>
{/key}

<style>
	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.5rem;
		margin: 0 0 1rem;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		margin-bottom: 2rem;
	}
</style>
