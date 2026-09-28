import { expect, type Locator } from '@playwright/test';

// Composite translucent backgrounds, then ink (or a handle surface) over them.
export async function textContrast(
  locator: Locator,
  requireText = true,
  surfaceInk = false
): Promise<number> {
  await expect(locator).toBeVisible();
  if (requireText)
    expect(
      (
        await locator.evaluate((element) =>
          element instanceof HTMLInputElement ? element.value : element.textContent
        )
      )?.trim()
    ).toBeTruthy();
  return locator.evaluate((element, surfaceInk) => {
    type Color = [number, number, number, number];
    const parse = (value: string): Color => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      if (channels.length < 3) throw new Error(`Unsupported computed color: ${value}`);
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const blend = (front: Color, back: Color): Color => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return [
        ...([0, 1, 2] as const).map(
          (channel) =>
            (front[channel] * front[3] + back[channel] * back[3] * (1 - front[3])) / alpha
        ),
        alpha
      ] as Color;
    };
    const stack: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) stack.unshift(node);
    let surface: Color = [255, 255, 255, 1];
    let opacity = 1;
    for (const node of stack) {
      const style = getComputedStyle(node);
      if (node !== element || !surfaceInk) surface = blend(parse(style.backgroundColor), surface);
      opacity *= Number(style.opacity);
    }
    const foreground = parse(getComputedStyle(element)[surfaceInk ? 'backgroundColor' : 'color']);
    foreground[3] *= opacity;
    const ink = blend(foreground, surface);
    const luminance = (color: Color) =>
      ([0.2126, 0.7152, 0.0722] as const).reduce((sum, weight, channel) => {
        const x = color[channel] / 255;
        return sum + weight * (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      }, 0);
    const a = luminance(ink),
      b = luminance(surface);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, surfaceInk);
}
