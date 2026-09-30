import { it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
vi.mock('./auth', () => ({ dataDirectory: () => '/tmp' }));
import { HouseholdStore } from './households';
const dirs: string[] = [];
const stores: HouseholdStore[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'household-test-'));
  dirs.push(dir);
  const store = new HouseholdStore(join(dir, 'test.sqlite'));
  stores.push(store);
  return store;
}
afterEach(() => {
  vi.useRealTimers();
  stores.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
it('invitations expire, cannot be replayed, and can be revoked', () => {
  const s = fixture();
  s.create('a', 'a@example.test', 'Home');
  const token = s.invite('a');
  expect(s.invitation(token).name).toBe('Home');
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 8 * 86400000);
  expect(() => s.join('b', 'b@example.test', token)).toThrow(/expired/);
  expect(s.household('b')).toBeNull();
  vi.useRealTimers();
  const valid = s.invite('a');
  s.join('b', 'b@example.test', valid);
  expect(() => s.join('c', 'c@example.test', valid)).toThrow(/already used/);
  const revoked = s.invite('a');
  s.manage('a', 'revoke', '');
  expect(() => s.invitation(revoked)).toThrow();
});
it('multiple owners can step down and former members immediately lose access', () => {
  const s = fixture();
  const home = s.create('a', 'a@example.test', 'Home');
  s.join('b', 'b@example.test', s.invite('a'));
  expect(() => s.manage('a', 'leave', '')).toThrow(/at least one owner/);
  expect(() => s.manage('b', 'remove', 'a')).toThrow(/owner/);
  s.manage('a', 'promote', 'b');
  expect(s.household('a')?.role).toBe('owner');
  expect(s.household('b')?.role).toBe('owner');
  s.manage('a', 'demote', 'a');
  expect(s.household('a')?.role).toBe('member');
  expect(s.household('b')?.role).toBe('owner');
  s.manage('b', 'remove', 'a');
  expect(s.household('a')).toBeNull();
  expect(s.household('b')?.id).toBe(home.id);
});
it('cannot join two households or manage another household', () => {
  const s = fixture();
  s.create('a', 'a@example.test', 'A');
  s.create('b', 'b@example.test', 'B');
  const token = s.invite('a');
  expect(() => s.join('b', 'b@example.test', token)).toThrow(/current household/);
  expect(() => s.manage('a', 'remove', 'b')).toThrow(/another household member/);
  s.join('c', 'c@example.test', token);
  expect(s.household('c')?.name).toBe('A');
});

it('protects the last owner and scopes role changes to authorized household owners', () => {
  const s = fixture();
  s.create('a', 'a@example.test', 'A');
  s.create('x', 'x@example.test', 'B');
  s.join('b', 'b@example.test', s.invite('a'));
  expect(() => s.manage('a', 'demote', 'a')).toThrow(/at least one owner/);
  expect(() => s.manage('b', 'promote', 'b')).toThrow(/owners/);
  expect(() => s.manage('a', 'promote', 'x')).toThrow(/household member/);
  s.manage('a', 'promote', 'b');
  s.manage('b', 'rename', 'Renamed');
  expect(s.household('a')?.name).toBe('Renamed');
  s.manage('a', 'leave', '');
  expect(s.household('a')).toBeNull();
  expect(() => s.manage('b', 'leave', '')).toThrow(/at least one owner/);
  expect(() => s.manage('b', 'demote', 'b')).toThrow(/at least one owner/);
  expect(s.household('b')?.role).toBe('owner');
});
it('an owner can remove another owner but a demoted owner cannot manage membership', () => {
  const s = fixture();
  s.create('a', 'a@example.test', 'Home');
  s.join('b', 'b@example.test', s.invite('a'));
  s.manage('a', 'promote', 'b');
  s.manage('b', 'demote', 'a');
  expect(() => s.manage('a', 'promote', 'a')).toThrow(/owners/);
  s.manage('b', 'promote', 'a');
  s.manage('b', 'remove', 'a');
  expect(s.household('a')).toBeNull();
  expect(s.household('b')?.role).toBe('owner');
});

it('lists active invitations for owners and revokes only the selected link', () => {
  const s = fixture();
  s.create('a', 'a@example.test', 'A');
  s.create('x', 'x@example.test', 'B');
  s.join('b', 'b@example.test', s.invite('a'));
  const first = s.invite('a');
  const second = s.invite('a');
  const invites = s.details('a').invitations as { id: string; token: string; expires: number }[];
  expect(invites.map((i) => i.token)).toEqual(expect.arrayContaining([first, second]));
  expect(s.details('b').invitations).toEqual([]);
  const selected = invites.find((i) => i.token === first)!;
  expect(() => s.manage('x', 'revoke-invite', selected.id)).toThrow(/no longer available/);
  expect(() => s.manage('b', 'revoke-invite', selected.id)).toThrow(/owners/);
  s.manage('a', 'revoke-invite', selected.id);
  expect(() => s.invitation(first)).toThrow();
  expect(s.invitation(second).name).toBe('A');
  s.join('c', 'c@example.test', second);
  expect(s.details('a').invitations).toHaveLength(0);
  s.invite('a');
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 8 * 86400000);
  expect(s.details('a').invitations).toHaveLength(0);
});

it('stores language per user independently of their shared household', () => {
  const s = fixture();
  s.create('a', 'a@example.test', 'Unser Zuhause');
  s.join('b', 'b@example.test', s.invite('a'));
  expect(s.locale('a')).toBeNull();
  s.setLocale('a', 'de');
  s.setLocale('b', 'en');
  expect(s.locale('a')).toBe('de');
  expect(s.locale('b')).toBe('en');
  expect(s.household('a')?.name).toBe('Unser Zuhause');
  s.manage('a', 'remove', 'b');
  expect(s.locale('b')).toBe('en');
});
