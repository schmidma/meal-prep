/** Let long recipe methods scroll with the dialog, rather than inside the field. */
export function autoGrow(node: HTMLTextAreaElement) {
  let width = 0;
  function resize() {
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight + 2}px`;
  }
  const frame = requestAnimationFrame(resize);
  const observer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width !== width) {
      width = entry.contentRect.width;
      resize();
    }
  });
  observer.observe(node);
  node.addEventListener('input', resize);
  return {
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      node.removeEventListener('input', resize);
    }
  };
}
