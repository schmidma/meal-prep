import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
export const origin = 'http://127.0.0.1:4173';
export async function signIn(request: APIRequestContext, email: string) {
  const sent = await request.post('/api/auth/email-otp/send-verification-otp', {
    headers: { Origin: origin },
    data: { email, type: 'sign-in' }
  });
  expect(sent.status(), await sent.text()).toBe(200);
  const inbox = await request.get('/api/dev/inbox');
  const code = (await inbox.json()).find((mail: { email: string }) => mail.email === email)?.code;
  expect(code).toMatch(/^\d{6}$/);
  const signed = await request.post('/api/auth/sign-in/email-otp', {
    headers: { Origin: origin },
    data: { email, otp: code }
  });
  expect(signed.status(), await signed.text()).toBe(200);
  return code;
}
export async function householdAction(request: APIRequestContext, data: object) {
  return request.post('/api/household', { headers: { Origin: origin }, data });
}
