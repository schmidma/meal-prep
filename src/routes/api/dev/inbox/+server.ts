import { json } from '@sveltejs/kit';
import { readDevInbox } from '$lib/server/auth';
export const GET = () => json(readDevInbox(), { headers: { 'Cache-Control': 'no-store' } });
