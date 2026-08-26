#!/usr/bin/env node

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

export function loadEnvFile() {
  try {
    const text = readFileSync('.env', 'utf-8');
    const map = {};
    text.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) return;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key) map[key] = value;
    });
    return map;
  } catch {
    return {};
  }
}

export function readConfig(overrides = {}) {
  const envFile = loadEnvFile();
  const pick = (key, fallback = '') => process.env[key] || envFile[key] || fallback;

  return {
    supabaseUrl: pick('VITE_SUPABASE_URL'),
    supabaseAnonKey: pick('VITE_SUPABASE_ANON_KEY'),
    email: pick('STAGE8_TEST_EMAIL', pick('TEST_EMAIL')),
    password: pick('STAGE8_TEST_PASSWORD', pick('TEST_PASSWORD')),
    accessToken: pick('STAGE8_TEST_ACCESS_TOKEN'),
    refreshToken: pick('STAGE8_TEST_REFRESH_TOKEN'),
    userId: pick('STAGE8_TEST_USER_ID'),
    ...overrides,
  };
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function waitUntil(fn, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 500;
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const result = await fn();
    if (result) return true;
    await sleep(intervalMs);
  }
  return false;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createAuthedClient(config) {
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: config.accessToken
      ? {
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'x-user-jwt': config.accessToken,
          },
        }
      : undefined,
  });

  return {
    client,
    async login() {
      if (config.accessToken && config.refreshToken && config.userId) {
        return {
          session: {
            access_token: config.accessToken,
            refresh_token: config.refreshToken,
          },
          user: { id: config.userId },
        };
      }

      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: config.email,
          password: config.password,
        });
        if (error) throw new Error(error.message);
        const session = data.session;
        const user = data.user;
        if (!session?.access_token || !user?.id) {
          throw new Error('登录成功但未获取到会话 token');
        }
        return { session, user };
      } catch (primaryError) {
        const fallback = loginWithCurl(config);
        const { error: setSessionError, data: setSessionData } = await client.auth.setSession({
          access_token: fallback.access_token,
          refresh_token: fallback.refresh_token,
        });
        if (setSessionError) {
          throw new Error(`登录失败: ${setSessionError.message}`);
        }

        const session = setSessionData.session || {
          access_token: fallback.access_token,
          refresh_token: fallback.refresh_token,
        };
        const user = setSessionData.user || fallback.user;
        if (!session?.access_token || !user?.id) {
          throw new Error(`登录失败: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`);
        }
        return { session, user };
      }
    },
  };
}

function loginWithCurl(config) {
  const url = `${config.supabaseUrl}/auth/v1/token?grant_type=password`;
  const payload = JSON.stringify({
    email: config.email,
    password: config.password,
  });

  let raw = '';
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      raw = execFileSync('curl', [
        '-sS',
        '--retry', '2',
        '--retry-delay', '1',
        '--connect-timeout', '10',
        '--max-time', '30',
        url,
        '-H', `apikey: ${config.supabaseAnonKey}`,
        '-H', 'Content-Type: application/json',
        '-d', payload,
      ], {
        encoding: 'utf-8',
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 500);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('登录失败: curl 返回了无法解析的响应');
  }

  if (!parsed?.access_token || !parsed?.refresh_token || !parsed?.user?.id) {
    throw new Error(`登录失败: ${parsed?.msg || parsed?.error_description || parsed?.error || 'unknown'}`);
  }

  return parsed;
}

export function buildEdgeHeaders(config, accessToken, traceId) {
  return {
    'Content-Type': 'application/json',
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${config.supabaseAnonKey}`,
    'x-user-jwt': accessToken,
    'x-trace-id': traceId,
  };
}

export async function callEdgeFunction(config, accessToken, functionName, body, traceId) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: buildEdgeHeaders(config, accessToken, traceId),
    body: JSON.stringify({
      ...body,
      userJwt: accessToken,
    }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export function printSuiteHeader(title) {
  const bar = '='.repeat(76);
  console.log(bar);
  console.log(title);
  console.log(bar);
}

export function printStep(prefix, message) {
  console.log(`${prefix} ${message}`);
}

export function ensureRequiredConfig(config, keys) {
  keys.forEach((key) => {
    assert(config[key], `缺少必要配置: ${key}`);
  });
}
