import { get, writable } from 'svelte/store';

export type Confirmation = {
  title: string;
  message: string;
  choices: { value: string; label: string }[];
  resolve: (value: string | null) => void;
};
export const confirmation = writable<Confirmation | null>(null);
export function askChoice(title: string, message: string, choices: Confirmation['choices']) {
  if (get(confirmation)) return Promise.resolve(null);
  return new Promise<string | null>((resolve) =>
    confirmation.set({ title, message, choices, resolve })
  );
}
export async function confirmAction(
  message: string,
  label = 'Discard changes',
  title = 'Discard changes?'
) {
  return (await askChoice(title, message, [{ value: 'confirm', label }])) === 'confirm';
}
