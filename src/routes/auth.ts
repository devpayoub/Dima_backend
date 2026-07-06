import { Router, Request, Response } from 'express';
import { supabaseAdmin, supabaseAuth, supabaseForToken } from '../supabaseClient';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimit';
import { rowToProfile } from '../utils/mappers';

const router = Router();

// POST /api/v1/auth/login — Owner login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    if (error.message.toLowerCase().includes('email not confirmed')) {
      res.status(401).json({ error: 'Please confirm your email before signing in.' });
      return;
    }
    res.status(401).json({ error: 'Unable to sign in. Please check your credentials and try again.' });
    return;
  }

  const db = supabaseForToken(data.session.access_token);
  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();

  res.json({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    },
    user: rowToProfile(profile),
  });
});

// POST /api/v1/auth/login/staff — Staff PIN login
router.post('/login/staff', authLimiter, async (req: Request, res: Response) => {
  const { email, pin, orgId } = req.body;
  if (!email || !pin || !orgId) {
    res.status(400).json({ error: 'Email, PIN, and orgId are required' });
    return;
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password: pin,
  });

  if (error) {
    res.status(401).json({ error: 'Email or PIN is incorrect.' });
    return;
  }

  const db = supabaseForToken(data.session.access_token);
  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'staff') {
    await supabaseAuth.auth.signOut();
    res.status(403).json({ error: 'This is not a staff account.' });
    return;
  }
  if (profile.access === 'disabled') {
    await supabaseAuth.auth.signOut();
    res.status(403).json({ error: 'This account is disabled. Ask the owner to re-enable it.' });
    return;
  }
  if (profile.owner_id !== orgId) {
    await supabaseAuth.auth.signOut();
    res.status(403).json({ error: "Org ID doesn't match this staff account." });
    return;
  }

  res.json({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    },
    user: rowToProfile(profile),
  });
});

// POST /api/v1/auth/signup — Owner signup
router.post('/signup', async (req: Request, res: Response) => {
  res.status(403).json({ error: 'Self-serve registration is disabled. Please contact sales for access.' });
});

// POST /api/v1/auth/logout — Sign out
router.post('/logout', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  await db.auth.signOut();
  res.json({ ok: true });
});

// GET /api/v1/auth/me — Get current user + owner profile
router.get('/me', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('id', req.user!.id)
    .maybeSingle();

  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  let ownerProfile = null;
  let staffAccounts: any[] = [];

  if (profile.role === 'owner') {
    const { data: staff } = await db
      .from('profiles')
      .select('*')
      .eq('owner_id', req.user!.id)
      .eq('role', 'staff');
    staffAccounts = (staff ?? []).map(rowToProfile);
  } else if (profile.owner_id) {
    const { data: owner } = await db
      .from('profiles')
      .select('*')
      .eq('id', profile.owner_id)
      .maybeSingle();
    ownerProfile = rowToProfile(owner);
  }

  res.json({
    profile: rowToProfile(profile),
    ownerProfile,
    staffAccounts,
  });
});

// POST /api/v1/auth/reset-password — Send password reset email
router.post('/reset-password', passwordResetLimiter, async (req: Request, res: Response) => {
  const { email, redirectTo } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const { error } = await supabaseAuth.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo }
  );

  if (error) {
    res.status(400).json({ error: 'Unable to send reset email right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

// POST /api/v1/auth/update-password — Update password (requires active session)
router.post('/update-password', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters.' });
    return;
  }

  const { error } = await supabaseAuth.auth.admin.updateUserById(req.user!.id, {
    password: newPassword,
  });

  if (error) {
    res.status(400).json({ error: 'Unable to update password right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

// POST /api/v1/auth/resend-verification — Resend email confirmation
router.post('/resend-verification', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const { redirectTo } = req.body;

  const { error } = await db.auth.resend({
    type: 'signup',
    email: req.user!.email,
    options: { emailRedirectTo: redirectTo },
  });

  if (error) {
    res.status(400).json({ error: 'Unable to resend verification email right now. Please try again.' });
    return;
  }
  res.json({ ok: true, message: 'Verification email sent. Check your inbox and spam folder.' });
});

export default router;
