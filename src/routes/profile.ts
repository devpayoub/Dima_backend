import { Router, Response } from 'express';
import { supabaseForToken, supabaseAdmin } from '../supabaseClient';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { requireOwner } from '../middleware/requireOwner';
import { rowToProfile } from '../utils/mappers';

const router = Router();
router.use(requireAuth as any);

// GET /api/v1/profile/slug-available/:slug
router.get('/slug-available/:slug', async (req: AuthenticatedRequest, res: Response) => {
  const { slug } = req.params;
  const { data, error } = await supabaseAdmin.rpc('is_slug_available', { slug_input: slug });
  if (error) {
    res.status(500).json({ error: 'Unable to check slug availability' });
    return;
  }
  res.json({ available: data === true });
});

// GET /api/v1/profile/by-slug/:slug — public-style lookup for staff login page
router.get('/by-slug/:slug', async (req: AuthenticatedRequest, res: Response) => {
  const { slug } = req.params;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, slug, business_name, role')
    .eq('slug', slug)
    .eq('role', 'owner')
    .single();
  if (error || !data) {
    res.status(404).json({ error: 'No owner found with that slug' });
    return;
  }
  res.json(rowToProfile(data));
});

// PATCH /api/v1/profile — Update profile (owner only)
router.patch('/', requireOwner as any, async (req: AuthenticatedRequest, res: Response) => {
  const { businessName, email, slug } = req.body;
  const updates: Record<string, string> = {};
  if (businessName?.trim()) updates.business_name = businessName.trim();
  if (email?.trim()) updates.email = email.trim().toLowerCase();
  if (slug?.trim()) updates.slug = slug.trim().toLowerCase();

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No fields provided to update' });
    return;
  }

  const db = supabaseForToken(req.user!.token);
  const { error } = await db.from('profiles').update(updates).eq('id', req.user!.id);
  if (error) {
    res.status(500).json({ error: 'Unable to update profile right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

export default router;
