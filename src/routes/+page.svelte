<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Matka demo</title></svelte:head>

<h1>Matka</h1>
<p>
	Buy a test print, then roll the die. Roll a six and the order is refunded. The roll is made on the
	server when Stripe says the order's paid; the page only shows it.
</p>

{#if !data.stripe}
	<p class="note">
		Set <code>STRIPE_SECRET_KEY</code> (a test key) in <code>.env</code> to buy one. See
		<code>.env.example</code>.
	</p>
{:else}
	{#if !data.webhook}
		<p class="note">
			Run <code>npm run stripe:listen</code> and put the <code>whsec_…</code> it prints in
			<code>.env</code> as <code>STRIPE_WEBHOOK_SECRET</code>, or no roll will be made.
		</p>
	{/if}
	<form method="POST">
		<button>Buy a test print (£1)</button>
	</form>
	<p class="quiet">
		Pay with <code>4242 4242 4242 4242</code>, any future date, any CVC. Rolls are kept in
		<code>{data.store}</code>.
	</p>
{/if}

<p><a href="/playground">Playground</a>: try the themes without paying.</p>

<style>
	.note {
		border-left: 3px solid var(--accent);
		padding-left: 1rem;
	}
	.quiet {
		color: var(--quiet);
		font-size: 0.9em;
	}
</style>
