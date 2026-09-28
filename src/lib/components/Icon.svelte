<script lang="ts">
  export type IconName =
    | 'bowl'
    | 'book'
    | 'plus'
    | 'left'
    | 'right'
    | 'clock'
    | 'edit'
    | 'link'
    | 'check'
    | 'close'
    | 'leaf'
    | 'cake'
    | 'calendar'
    | 'info'
    | 'trash'
    | 'home'
    | 'alert'
    | 'arrow'
    | 'sun'
    | 'moon'
    | 'monitor'
    | 'reset'
    | 'grip';
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
  const paths: Record<IconName, string> = {
    bowl: 'M3 10h18a9 9 0 0 1-18 0ZM6 21h12M8 3v3m4-4v4m4-3v3',
    book: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1m0-15v15',
    plus: 'M12 5v14M5 12h14',
    left: 'm14 6-6 6 6 6',
    right: 'm10 6 6 6-6 6',
    clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    edit: 'm16 3 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7 7-2',
    link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1',
    check: 'm5 12 4 4L19 6',
    close: 'm6 6 12 12M6 18 18 6',
    leaf: 'M20 3C8 1 2 7 5 15s16 5 15-12ZM5 21l9-12',
    cake: 'M3 12h18v9H3v-9Zm0 3c3 3 4-3 7 0s4-3 7 0 4 0 4 0M7 12V8m5 4V7m5 5V8M7 4v1m5-3v1m5 1v1',
    calendar: 'M4 5h16v16H4V5Zm3-3v6m10-6v6M4 10h16',
    info: 'M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    home: 'm3 10 9-8 9 8M5 8v13h14V8M9 21v-8h6v8',
    alert: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v.1',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
    moon: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z',
    monitor: 'M3 4h18v13H3V4Zm9 13v4m-5 0h10',
    reset: 'M3 4v6h6M3 10a9 9 0 1 1 1 8',
    grip: 'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01'
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.65"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name]} /></svg
>
