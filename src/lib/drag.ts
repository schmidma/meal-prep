export type DragPoint = { x: number; y: number };

// Keep the fence until the gesture's release: Escape can precede pointerup by any duration.
function fenceGestureClick(pointerId: number, alreadyReleased: boolean) {
  let released = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function cleanup() {
    if (timeout !== undefined) clearTimeout(timeout);
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('blur', cleanup);
    window.removeEventListener('click', click, true);
  }
  function arm() {
    released = true;
    timeout = setTimeout(cleanup, 350);
  }
  function down() {
    cleanup();
  }
  function up(event: PointerEvent) {
    if (event.pointerId === pointerId) arm();
  }
  function cancel(event: PointerEvent) {
    if (event.pointerId === pointerId) cleanup();
  }
  function click(event: MouseEvent) {
    if (!released || event.detail === 0) return;
    const clickPointerId = (event as PointerEvent).pointerId;
    if (typeof clickPointerId === 'number' && clickPointerId !== pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cleanup();
  }
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('blur', cleanup);
  window.addEventListener('click', click, true);
  if (alreadyReleased) arm();
}

/** A small pointer gesture, shared by mouse and touch handles. Clicks remain clicks. */
export function pointerDrag(
  event: PointerEvent,
  callbacks: {
    move: (point: DragPoint) => void;
    drop: (point: DragPoint) => void;
    cancel: () => void;
  }
): () => void {
  if (event.button !== 0 || !event.isPrimary) return () => {};
  const element = event.currentTarget as HTMLElement;
  const pointerId = event.pointerId;
  const origin = { x: event.clientX, y: event.clientY };
  let point = origin;
  let active = false;
  let disposed = false;
  let frame = 0;
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* Window listeners still handle mouse. */
  }

  function animate() {
    if (disposed || !active) return;
    callbacks.move(point);
    frame = requestAnimationFrame(animate);
  }
  function move(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    point = { x: e.clientX, y: e.clientY };
    if (!active && Math.hypot(point.x - origin.x, point.y - origin.y) >= 6) {
      active = true;
      document.body.classList.add('is-dragging');
      animate();
    }
    if (active) e.preventDefault();
  }
  function cleanup() {
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', pointerCancel);
    window.removeEventListener('blur', blur);
    window.removeEventListener('keydown', key);
    document.body.classList.remove('is-dragging');
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
  }
  function up(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    point = { x: e.clientX, y: e.clientY };
    cleanup();
    if (!active) return;
    // A completed drag must not also open the card/empty slot under the release.
    fenceGestureClick(pointerId, true);
    callbacks.drop(point);
  }
  function cancel() {
    if (disposed) return;
    if (active) fenceGestureClick(pointerId, false);
    cleanup();
    if (active) callbacks.cancel();
  }
  function pointerCancel(e: PointerEvent) {
    if (e.pointerId !== pointerId || disposed) return;
    cleanup();
    if (active) callbacks.cancel();
  }
  function blur() {
    if (disposed) return;
    cleanup();
    if (active) callbacks.cancel();
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', pointerCancel);
  window.addEventListener('blur', blur);
  window.addEventListener('keydown', key);
  return cancel;
}
