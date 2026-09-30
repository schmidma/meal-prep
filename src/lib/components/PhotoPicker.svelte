<script lang="ts">
  import type { MessageKey } from '$lib/i18n/messages';
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { householdFetch } from '$lib/household-client';
  import Icon from './Icon.svelte';
  import { onDestroy } from 'svelte';
  import { foodPhotos, foodIllustrations, photoUrl, illustrationId } from '$lib/food-photos';
  let {
    value,
    onChange,
    onDone,
    busy = $bindable(false)
  }: {
    value: string;
    onChange: (value: string) => void;
    onDone: () => void;
    busy?: boolean;
  } = $props();
  let input: HTMLInputElement;
  let error = $state('');
  let controller: AbortController | undefined;
  onDestroy(() => controller?.abort());
  async function upload(file?: File) {
    if (!file) return;
    error = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      error = i18n.t('photo-picker.chooseAJPGPNGOrWebPImage');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      error = i18n.t('photo-picker.chooseAnImageSmallerThan20MB');
      return;
    }
    busy = true;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error(i18n.t('photo-picker.couldNotReadThisImage'));
      context.fillStyle = '#f7f5ef';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error(i18n.t('photo-picker.couldNotReadThisImage'))),
          'image/jpeg',
          0.85
        )
      );
      const response = await householdFetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
        signal
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || i18n.t('photo-picker.uploadFailedTryAgain'));
      if (!signal.aborted) onChange(result.id);
    } catch (cause) {
      if (!signal.aborted)
        error =
          cause instanceof Error
            ? i18n.error(cause.message)
            : i18n.t('photo-picker.uploadFailedTryAgain');
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }
</script>

<div class="wp-photo-editor">
  <div class="wp-photo-heading">
    <h3>{i18n.t('photo-picker.chooseAnImage')}</h3>
    <button type="button" class="wp-secondary" disabled={busy} onclick={onDone}
      ><Icon name="left" size={16} />{i18n.t('photo-picker.backToDetails')}</button
    >
  </div>
  <div class="wp-photo-current">
    <img src={photoUrl(value)} alt={i18n.t('photo-picker.recipePreview')} />
    <div>
      <input
        bind:this={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={i18n.t('photo-picker.uploadPhoto')}
        hidden
        onchange={(e) => upload(e.currentTarget.files?.[0])}
      />
      <button type="button" class="wp-secondary" disabled={busy} onclick={() => input.click()}
        >{busy
          ? i18n.t('photo-picker.uploading')
          : value.startsWith('upload-')
            ? i18n.t('photo-picker.replacePhoto')
            : i18n.t('photo-picker.uploadPhoto')}</button
      >
      <small>{i18n.t('photo-picker.jpgPNGOrWebPUpTo20')}</small>
    </div>
  </div>
  {#if error}<p class="wp-alert" role="alert">{error}</p>{/if}
  <div class="wp-photo-choices" role="group" aria-label={i18n.t('photo-picker.illustrations')}>
    {#each foodIllustrations as item}
      <button
        type="button"
        class:selected={!value.startsWith('upload-') &&
          !foodPhotos.some((photo) => photo.id === value) &&
          illustrationId(value) === item.id}
        aria-pressed={!value.startsWith('upload-') &&
          !foodPhotos.some((photo) => photo.id === value) &&
          illustrationId(value) === item.id}
        aria-label={i18n.t('photos.useIllustration', {
          name: i18n.t(('illustrations.' + item.id) as MessageKey)
        })}
        disabled={busy}
        onclick={() => onChange(item.id)}
        ><img src={photoUrl(item.id)} alt="" /><span
          >{i18n.t(('illustrations.' + item.id) as MessageKey)}</span
        ></button
      >
    {/each}
  </div>
  {#if busy}<span role="status">{i18n.t('photo-picker.preparingYourPhoto')}</span>{/if}
</div>
