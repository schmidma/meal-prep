<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { getInspector } from '$lib/inspector';
  const inspector = getInspector();
  let {
    anchor,
    point,
    label,
    onclose,
    compact = false,
    header,
    identity,
    backLabel,
    onback,
    children
  }: {
    anchor?: HTMLElement | null;
    point?: { x: number; y: number } | (() => { x: number; y: number } | undefined);
    label: string;
    onclose: () => void;
    compact?: boolean;
    header?: Snippet;
    identity?: string;
    backLabel?: string;
    onback?: () => void;
    children: Snippet;
  } = $props();
  let panel: HTMLDivElement;
  let closing = false;
  let invoker: HTMLElement | null = null;
  let reposition = () => {};
  let identityOverflow = $state(false);
  let fullIdentity = $state('');
  // Observe the real editable title, including uncommitted input. Never write its value.
  // Reconnect when a mounted inspector switches between library and entity headers.
  $effect(() => {
    const enabled = identity !== undefined;
    const input = enabled ? panel?.querySelector<HTMLInputElement>('.edit-title') : null;
    identityOverflow = false;
    if (!input) return;
    const measure = () => {
      fullIdentity = input.value;
      identityOverflow = input.scrollWidth > input.clientWidth + 1;
    };
    let frame = 0;
    let mounted = true;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(input);
    void document.fonts.ready.then(() => {
      if (mounted) scheduleMeasure();
    });
    input.addEventListener('input', measure);
    // Let the field's handler trim or reject its edit before reading the final value.
    input.addEventListener('change', scheduleMeasure);
    measure();
    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      input.removeEventListener('input', measure);
      input.removeEventListener('change', scheduleMeasure);
    };
  });
  $effect(() => {
    inspector.expanded;
    reposition();
  });
  function back() {
    if (panel.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (onback) onback();
    else inspector.back();
  }
  function dismiss() {
    if (closing) return;
    closing = true;
    // Commit onchange edits before the parent removes the focused input.
    if (panel.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    const opener = anchor?.isConnected ? anchor : invoker;
    onclose();
    const restore = opener?.closest('details:not([open])')?.querySelector('summary') ?? opener;
    if (restore instanceof HTMLElement && restore.isConnected) {
      restore.dataset.restoringFocus = '';
      restore.focus({ preventScroll: true });
      delete restore.dataset.restoringFocus;
    }
  }
  onMount(() => {
    invoker =
      anchor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const position = () => {
      if (!compact) {
        const workspace = document.querySelector('.workspace')?.getBoundingClientRect();
        const rail = window.innerWidth >= 1100;
        if (rail && inspector.expanded) inspector.setExpanded(false);
        panel.style.left = rail
          ? `${(workspace?.right ?? window.innerWidth - 24) - 360}px`
          : '12px';
        const top = Math.max(12, workspace?.top ?? 130);
        panel.style.top = rail ? `${top}px` : 'auto';
        panel.style.height = rail ? `${window.innerHeight - top - 14}px` : 'auto';
        panel.style.maxHeight = rail ? 'none' : '';
        panel.style.bottom = rail ? '14px' : '12px';
        if (!rail) {
          // Prefer leaving the stock shelf visible, but never let a tall shelf or
          // disclosed identity consume the useful body area of the drawer.
          const shelf = document.querySelector('.home-tray')?.getBoundingClientRect();
          const height = inspector.expanded
            ? `${window.innerHeight - 24}px`
            : `${Math.min(
                window.innerHeight - 24,
                Math.max(
                  (panel.querySelector<HTMLElement>('.inspector-header')?.offsetHeight ?? 0) + 136,
                  window.innerHeight - Math.max(12, shelf?.bottom ?? top) - 24
                )
              )}px`;
          panel.style.height = height;
          panel.style.maxHeight = height;
        }
        return;
      }
      const width = Math.min(330, window.innerWidth - 24);
      const at = typeof point === 'function' ? point() : point;
      const rect = at ? { left: at.x, right: at.x, top: at.y } : anchor?.getBoundingClientRect();
      const left =
        rect && rect.right + width + 16 < window.innerWidth
          ? rect.right + 10
          : rect
            ? rect.left - width - 10
            : window.innerWidth - width - 24;
      panel.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, left))}px`;
      panel.style.top = `${window.innerWidth < 700 ? 90 : Math.max(78, Math.min(window.innerHeight - 410, rect?.top ?? 130))}px`;
      panel.style.setProperty(
        '--panel-height',
        `${window.innerHeight - parseFloat(panel.style.top) - 14}px`
      );
    };
    reposition = position;
    position();
    panel.showPopover();
    const autofocus =
      compact || window.innerWidth >= 700
        ? panel.querySelector<HTMLInputElement>('[data-autofocus]')
        : null;
    (autofocus ?? panel).focus({ preventScroll: true });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    let sizeFrame = 0;
    const headerSize = new ResizeObserver(() => {
      cancelAnimationFrame(sizeFrame);
      sizeFrame = requestAnimationFrame(position);
    });
    headerSize.observe(panel.querySelector('.inspector-header')!);

    // A click can be retargeted to the grid after the panel is removed. Keep its
    // capture listener alive through that click, independent of component teardown.
    function suppressClick(pointerId: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clear = () => {
        clearTimeout(timer);
        document.removeEventListener('click', consume, true);
        window.removeEventListener('pointerup', release, true);
        window.removeEventListener('pointercancel', cancel, true);
        window.removeEventListener('blur', clear);
      };
      const consume = (event: MouseEvent) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        clear();
      };
      const release = (event: PointerEvent) => {
        if (event.pointerId === pointerId) timer = setTimeout(clear, 0);
      };
      const cancel = (event: PointerEvent) => {
        if (event.pointerId === pointerId) clear();
      };
      document.addEventListener('click', consume, true);
      window.addEventListener('pointerup', release, true);
      window.addEventListener('pointercancel', cancel, true);
      window.addEventListener('blur', clear);
    }
    const outside = (target: EventTarget | null) =>
      target instanceof Node &&
      !panel.contains(target) &&
      !(
        target instanceof Element &&
        target.closest('button[data-inspector-destination]:not(:disabled)')
      );
    const onPointerDown = (event: PointerEvent) => {
      if (!outside(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick(event.pointerId);
      dismiss();
    };
    const onClick = (event: MouseEvent) => {
      if (!outside(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      reposition = () => {};
      headerSize.disconnect();
      cancelAnimationFrame(sizeFrame);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

<div
  bind:this={panel}
  popover="manual"
  class="quick-popover"
  class:detail-inspector={!compact}
  role="dialog"
  aria-label={label}
  tabindex="-1"
>
  <header class="inspector-header">
    <div>
      {#if !compact}
        <nav class="inspector-destinations" aria-label="Inspector">
          <button
            data-inspector-destination="issues"
            aria-pressed={inspector.destination === 'issues'}
            onclick={() => inspector.switchTo('issues')}
            >Checks <span>{inspector.checkCount}</span></button
          >
          <button
            data-inspector-destination="recipes"
            aria-pressed={inspector.destination === 'recipes'}
            onclick={() => inspector.switchTo('recipes')}>Recipes</button
          >
          <button
            class="inspector-expand"
            aria-expanded={inspector.expanded}
            onclick={() => inspector.setExpanded(!inspector.expanded)}
            >{inspector.expanded ? 'Reduce' : 'Expand'} details</button
          >
        </nav>
        {#if onback || inspector.backToChecks}
          <button class="text-button inspector-back" onclick={back}
            ><Icon name="left" size={13} /> {backLabel ?? 'Back to checks'}</button
          >
        {/if}
      {/if}
      {#if header}{@render header()}{:else}<strong>{label}</strong>{/if}
      {#if identityOverflow}
        <details class="inspector-identity">
          <summary>Full name</summary>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable content needs keyboard focus -->
          <div tabindex="0" role="region" aria-label="Full name">{fullIdentity}</div>
        </details>
      {/if}
    </div>
    <button class="popover-close icon-button" aria-label="Close details" onclick={dismiss}
      ><Icon name="close" size={16} /></button
    >
  </header>
  <div class="inspector-body">{@render children()}</div>
</div>
