import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}
if (!supabaseServiceRoleKey) {
  console.warn('[supabase] Missing SUPABASE_SERVICE_ROLE_KEY — admin operations will fail');
}

/**
 * Standard anon client — respects Row Level Security (RLS).
 * Use this with a user's JWT for user-scoped queries.
 */
export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Admin client — bypasses RLS using the service role key.
 * Use ONLY for privileged DB queries (e.g., selecting/updating rows).
 * NEVER call auth.* methods on this client — it will set an internal
 * session and all subsequent DB queries will use the user's JWT
 * instead of the service role key, breaking RLS bypass.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey || supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Auth admin client — uses the service role key for auth operations only
 * (signIn, signOut, createUser, deleteUser, updateUserById, getUser, etc.).
 * Kept separate from supabaseAdmin so auth calls don't pollute DB query state.
 */
export const supabaseAuth = createClient(supabaseUrl, supabaseServiceRoleKey || supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Returns an authenticated Supabase client scoped to the provided JWT.
 * The client sends the token as the Authorization header so RLS applies correctly.
 * Cached per token to avoid creating a new client for every request.
 */
const tokenClientCache = new Map<string, any>();

export function supabaseForToken(token: string) {
  const cached = tokenClientCache.get(token);
  if (cached) return cached;
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  tokenClientCache.set(token, client);
  // Evict old entries if cache grows too large
  if (tokenClientCache.size > 200) {
    const firstKey = tokenClientCache.keys().next().value;
    if (firstKey) tokenClientCache.delete(firstKey);
  }
  return client;
}
