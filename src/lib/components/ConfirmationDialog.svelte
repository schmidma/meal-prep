<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { confirmation } from '$lib/confirmation';
  let dialog: HTMLDialogElement;
  $effect(() => {
    if ($confirmation && dialog && !dialog.open) dialog.showModal();
  });
  function finish(value: string | null) {
    const pending = $confirmation;
    dialog.close();
    confirmation.set(null);
    pending?.resolve(value);
  }
</script>

<dialog
  bind:this={dialog}
  class="app-confirmation"
  aria-labelledby="confirmation-title"
  oncancel={(event) => {
    event.preventDefault();
    finish(null);
  }}
  onclick={(event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      finish(null);
  }}
>
  {#if $confirmation}
    <h2 id="confirmation-title">{i18n.message($confirmation.title)}</h2>
    <p>{i18n.message($confirmation.message)}</p>
    <footer>
      <button onclick={() => finish(null)}>{i18n.t('planner.cancel')}</button>
      {#each $confirmation.choices as choice}
        <button class="action" onclick={() => finish(choice.value)}
          >{i18n.message(choice.label)}</button
        >
      {/each}
    </footer>
  {/if}
</dialog>

<style>
  .app-confirmation {
    width: min(460px, calc(100vw - 32px));
    padding: 26px;
    border: 1px solid #e4e7df;
    border-radius: 16px;
    background: #fafaf6;
    color: #283e33;
    color-scheme: light;
    font-family: var(--font-ui);
    box-shadow: 0 20px 70px #15271e30;
  }
  .app-confirmation::backdrop {
    background: #18281e66;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 21px;
    font-weight: 600;
  }
  p {
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
    color: #6b756e;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 24px;
  }
  button {
    padding: 10px 14px;
    border: 1px solid #dce1d7;
    border-radius: 8px;
    background: white;
    color: #283e33;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:hover {
    background: #e9eddf;
  }
  button.action {
    background: #42694e;
    border-color: #42694e;
    color: white;
  }
  button.action:hover {
    background: #34563e;
  }
</style>
