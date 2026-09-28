<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import type { RelationSelection } from '$lib/relationships';
  let {
    selection,
    label,
    onpreview,
    children
  }: {
    selection: RelationSelection;
    label: string;
    onpreview: (token: object, selection: RelationSelection | null, label: string) => void;
    children: Snippet;
  } = $props();
  const token = {};
  const clearPreview = untrack(() => onpreview);
  function leave() {
    clearPreview(token, null, '');
  }
  onDestroy(leave);
</script>

<div
  class="allocation-line relationship-row"
  role="group"
  aria-label={label}
  data-allocation-id={selection.allocationIds[0]}
  data-ingredient-use-id={selection.ingredientUseIds[0]}
  onpointermove={(event) => {
    if (
      event.isTrusted &&
      (event.pointerType === 'mouse' || event.pointerType === 'pen') &&
      event.buttons === 0 &&
      !document.body.classList.contains('is-dragging')
    )
      onpreview(token, selection, label);
  }}
  onpointerleave={leave}
  onfocusin={() => onpreview(token, selection, label)}
  onfocusout={(event) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    )
      leave();
  }}
>
  {@render children()}
</div>

<style>
  .relationship-row :global(.allocation-destination) {
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .relationship-row :global(.allocation-destination small) {
    display: block;
  }
  .relationship-row :global(.allocation-destination .text-button) {
    white-space: normal;
    text-align: left;
  }
  .relationship-row > :global(input),
  .relationship-row > :global(.icon-button) {
    flex-shrink: 0;
  }
</style>
