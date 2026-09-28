import { createContext } from 'svelte';

export type InspectorDestination = 'issues' | 'recipes';
export type InspectorController = {
  readonly destination: InspectorDestination | null;
  readonly checkCount: number;
  readonly backToChecks: boolean;
  readonly expanded: boolean;
  readonly ingredientDrafts: Record<string, string>;
  setIngredientDraft: (key: string, text: string) => void;
  switchTo: (destination: InspectorDestination) => void;
  back: () => void;
  setExpanded: (expanded: boolean) => void;
};

// The controller and its state belong to one page, never to a shared module singleton.
export const [getInspector, setInspector] = createContext<InspectorController>();
