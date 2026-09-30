import { detectLocale, isLocale, translate } from '../i18n/messages';
import { dev } from '$app/environment';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';

export const dataDirectory = () =>
  dirname(resolve(process.env.MEAL_PREP_DB_PATH || 'data/meal-prep.sqlite'));
// Only the isolated browser-test server exposes a test mailbox.
export const testInboxEnabled = () => dev && process.env.MAIL_DELIVERY === 'test';
export type DevMail = { email: string; code: string; at: number };
// Development-only, ephemeral and bounded. Never persisted or logged.
const inbox = new Map<string, DevMail>();
export function readDevInbox() {
  const now = Date.now();
  for (const [key, value] of inbox) if (now - value.at > 300_000) inbox.delete(key);
  return [...inbox.values()].sort((a, b) => b.at - a.at);
}
let ready: ReturnType<typeof makeAuth> | undefined;
async function makeAuth() {
  const directory = dataDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && dev) {
    const path = join(directory, '.development-auth-secret');
    try {
      secret = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      secret = randomBytes(48).toString('base64url');
      writeFileSync(path, secret, { mode: 0o600, flag: 'wx' });
    }
  }
  if (!secret || secret.length < 32)
    throw new Error('Set BETTER_AUTH_SECRET to at least 32 random characters.');
  const baseURL = process.env.ORIGIN || (dev ? 'http://127.0.0.1:5174' : undefined);
  if (!baseURL || (!dev && new URL(baseURL).protocol !== 'https:'))
    throw new Error('Set ORIGIN to the public HTTPS origin.');
  if (
    !dev &&
    (!process.env.SMTP_HOST || !process.env.MAIL_FROM || process.env.MAIL_DELIVERY !== 'smtp')
  )
    throw new Error('Configure SMTP delivery before starting production.');
  const path = join(directory, 'accounts.sqlite');
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const delivery = process.env.MAIL_DELIVERY || (dev ? 'console' : 'smtp');
  if (!['console', 'smtp', ...(dev ? ['test'] : [])].includes(delivery))
    throw new Error('MAIL_DELIVERY must be console (development) or smtp.');
  const smtp =
    delivery !== 'smtp'
      ? undefined
      : nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          requireTLS: process.env.SMTP_SECURE !== 'true',
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
            : undefined
        });
  const options = {
    appName: 'Meal Prep',
    database: db,
    baseURL,
    secret,
    advanced: { ipAddress: { ipAddressHeaders: ['x-meal-prep-client-ip'] } },
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false }
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: dev ? 300 : 30 },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        rateLimit: { window: 60, max: dev ? 100 : 3 },
        async sendVerificationOTP({ email, otp }, context) {
          if (testInboxEnabled()) {
            readDevInbox();
            if (inbox.size >= 100) inbox.delete(inbox.keys().next().value!);
            inbox.set(email, { email, code: otp, at: Date.now() });
            return;
          }
          if (dev && delivery === 'console') {
            console.info(`[Meal Prep sign-in] ${email}: ${otp} (expires in 5 minutes)`);
            return;
          }
          const headers = context?.request?.headers;
          const saved = headers?.get('cookie')?.match(/(?:^|;\s*)meal-prep-language=([^;]+)/)?.[1];
          const locale = isLocale(saved) ? saved : detectLocale(headers?.get('accept-language'));
          await smtp!.sendMail({
            from: process.env.MAIL_FROM,
            to: email,
            subject: translate(locale, 'auth.emailSubject'),
            text: translate(locale, 'auth.emailBody', { code: otp })
          });
        }
      })
    ]
  } satisfies BetterAuthOptions;
  // Migrate before constructing Better Auth: construction starts schema validation.
  // Sharing one promise also keeps simultaneous first requests from migrating twice.
  try {
    const migration = await getMigrations(options);
    await migration.runMigrations();
    const auth = betterAuth(options);
    await (await auth.$context).checkSchema?.();
    return auth;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function getAuth() {
  ready ??= makeAuth();
  return ready;
}
