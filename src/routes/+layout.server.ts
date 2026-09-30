import { detectLocale, isLocale } from '$lib/i18n/messages';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = ({ cookies, request }) => {
  const saved = cookies.get('meal-prep-language');
  return { locale: isLocale(saved) ? saved : detectLocale(request.headers.get('accept-language')) };
};
