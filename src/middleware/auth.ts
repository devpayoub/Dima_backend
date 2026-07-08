import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, supabaseAuth, supabaseForToken } from '../supabaseClient';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'owner' | 'staff';
    ownerId?: string;
    token: string;
  };
  db?: ReturnType<typeof supabaseForToken>;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  // Use supabaseAuth (not supabaseAdmin) for token validation
  // supabaseAdmin must NEVER have auth.* called on it — it breaks RLS bypass
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, owner_id')
    .eq('id', data.user.id)
    .single();

  req.user = {
    id: data.user.id,
    email: data.user.email ?? '',
    role: (profile?.role as 'owner' | 'staff') ?? 'owner',
    ownerId: profile?.owner_id,
    token,
  };

  req.db = supabaseForToken(token);

  next();
}

export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, is_admin')
    .eq('id', req.user.id)
    .single();

  if (error || !profile || !profile.is_admin) {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return;
  }

  next();
}
