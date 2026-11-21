import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';

const SECRET_FILE = path.resolve(process.cwd(), 'data', '.session_secret');

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}

export const SESSION_COOKIE_NAME = 'toothspa_admin_session';

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: 'super_admin' | 'manager' | 'reception';
}

export interface AdminRequest extends Request {
  admin?: AdminUser;
}

interface SessionPayload {
  id: number;
  email: string;
  role: 'super_admin' | 'manager' | 'reception';
  exp: number;
}

export function signSessionToken(admin: AdminUser): string {
  const payload: SessionPayload = {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.id || !parsed.exp || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    cookies[key] = val;
  }
  return cookies;
}

export function setSessionCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 12}`,
  ];
  if (isProd) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = cookies[SESSION_COOKIE_NAME] || bearer;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  const row = db
    .prepare('SELECT id, email, name, role, is_active FROM admins WHERE id = ?')
    .get(payload.id) as { id: number; email: string; name: string; role: AdminUser['role']; is_active: number } | undefined;

  if (!row || !row.is_active) {
    return res.status(401).json({ error: 'Account inactive or not found.' });
  }

  req.admin = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
  next();
}

export function requireRole(allowedRoles: AdminUser['role'][]) {
  return (req: AdminRequest, res: Response, next: NextFunction) => {
    if (!req.admin) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ error: 'Insufficient permissions for this action.' });
    }
    next();
  };
}
