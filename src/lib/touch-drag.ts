/** Long-press dragging keeps ordinary taps and swipe scrolling intact. */
export function touchDrag(
  node: HTMLElement,
  handlers: {
    start: () => boolean;
    move: (x: number, y: number) => void;
    end: (x: number, y: number) => void;
    cancel: () => void;
  }
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let active = false;
  let originX = 0;
  let originY = 0;
  let x = 0;
  let y = 0;
  let ghost: HTMLElement | undefined;
  let suppressClickUntil = 0;
  function cleanup() {
    clearTimeout(timer);
    timer = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    ghost?.remove();
    ghost = undefined;
    node.classList.remove('wp-touch-dragging');
    active = false;
  }
  function position() {
    if (ghost) ghost.style.transform = `translate(${x + 12}px, ${y - 36}px)`;
    handlers.move(x, y);
  }
  function scroll() {
    if (!active) return;
    const amount = y < 100 ? -8 : y > window.innerHeight - 110 ? 8 : 0;
    if (amount) {
      window.scrollBy(0, amount);
      position();
    }
    frame = requestAnimationFrame(scroll);
  }
  function start(event: TouchEvent) {
    if (event.touches.length !== 1) {
      cancel();
      return;
    }
    const touch = event.touches[0];
    originX = x = touch.clientX;
    originY = y = touch.clientY;
    timer = setTimeout(() => {
      timer = undefined;
      if (!handlers.start()) return;
      active = true;
      suppressClickUntil = Date.now() + 1000;
      ghost = node.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
      ghost.setAttribute('aria-hidden', 'true');
      ghost.classList.add('wp-touch-ghost');
      ghost.style.width = `${Math.min(node.getBoundingClientRect().width, 190)}px`;
      document.body.append(ghost);
      node.classList.add('wp-touch-dragging');
      position();
      frame = requestAnimationFrame(scroll);
    }, 420);
  }
  function move(event: TouchEvent) {
    if (event.touches.length !== 1) {
      cancel();
      return;
    }
    x = event.touches[0].clientX;
    y = event.touches[0].clientY;
    if (active) {
      if (event.cancelable) event.preventDefault();
      position();
    } else if (Math.hypot(x - originX, y - originY) > 9) {
      clearTimeout(timer);
      timer = undefined;
    }
  }
  function end(event: TouchEvent) {
    const wasActive = active;
    if (wasActive && event.cancelable) event.preventDefault();
    if (wasActive) suppressClickUntil = Date.now() + 500;
    cleanup();
    if (wasActive) handlers.end(x, y);
  }
  function cancel() {
    const wasActive = active;
    cleanup();
    if (wasActive) handlers.cancel();
  }
  function click(event: MouseEvent) {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  function contextMenu(event: Event) {
    if (active || timer) event.preventDefault();
  }
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: false });
  node.addEventListener('touchend', end, { passive: false });
  node.addEventListener('touchcancel', cancel);
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', contextMenu);
  return {
    update(next: typeof handlers) {
      handlers = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', cancel);
      node.removeEventListener('click', click, true);
      node.removeEventListener('contextmenu', contextMenu);
    }
  };
}
