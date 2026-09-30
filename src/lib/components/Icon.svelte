<script lang="ts">
  import {
    Settings,
    ShoppingCart,
    Soup,
    BookOpen,
    Plus,
    ChevronLeft,
    ChevronRight,
    Clock,
    Pencil,
    Link,
    Check,
    X,
    Leaf,
    CakeSlice,
    CalendarDays,
    Info,
    Trash2,
    House,
    TriangleAlert,
    ArrowRight,
    Sun,
    Moon,
    Monitor,
    RotateCcw,
    GripVertical,
    Image
  } from '@lucide/svelte';
  export type IconName =
    | 'settings'
    | 'cart'
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
    | 'grip'
    | 'image';
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
  const icons = {
    settings: Settings,
    cart: ShoppingCart,
    bowl: Soup,
    book: BookOpen,
    plus: Plus,
    left: ChevronLeft,
    right: ChevronRight,
    clock: Clock,
    edit: Pencil,
    link: Link,
    check: Check,
    close: X,
    leaf: Leaf,
    cake: CakeSlice,
    calendar: CalendarDays,
    info: Info,
    trash: Trash2,
    home: House,
    alert: TriangleAlert,
    arrow: ArrowRight,
    sun: Sun,
    moon: Moon,
    monitor: Monitor,
    reset: RotateCcw,
    grip: GripVertical,
    image: Image
  };
  const Glyph = $derived(icons[name]);
</script>

<Glyph {size} strokeWidth={1.75} aria-hidden="true" focusable="false" />
