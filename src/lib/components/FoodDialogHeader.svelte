<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import type { Snippet } from 'svelte';
  import { photoUrl } from '$lib/food-photos';
  import Icon from './Icon.svelte';
  let {
    title,
    titleId,
    image,
    editable = false,
    onPhoto,
    children
  }: {
    title: string;
    titleId: string;
    image: string;
    editable?: boolean;
    onPhoto?: () => void;
    children?: Snippet;
  } = $props();
</script>

<header class="wp-food-dialog-header">
  <img class="wp-food-dialog-art" src={photoUrl(image, 1200)} alt="" />
  <div class="wp-food-dialog-heading">
    <!-- Initial dialog focus belongs on its heading, not an editable field. -->
    <!-- svelte-ignore a11y_autofocus -->
    <h2 id={titleId} tabindex="-1" autofocus>{title}</h2>
    {#if children}{@render children()}{/if}
  </div>
  {#if editable}<button
      type="button"
      class="wp-icon-button wp-header-image-edit"
      aria-label={i18n.t('food-dialog-header.changeImage')}
      title={i18n.t('food-dialog-header.changeImage')}
      onclick={onPhoto}><Icon name="image" size={16} /></button
    >{/if}
</header>
