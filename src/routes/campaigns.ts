import { Router, Response } from 'express';
import { supabaseForToken, supabaseAdmin } from '../supabaseClient';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { requireOwner } from '../middleware/requireOwner';
import { rowToCampaign } from '../utils/mappers';

const router = Router();
router.use(requireAuth as any, requireOwner as any);

function campaignToRow(t: any, ownerId: string) {
  return {
    id: t.id,
    owner_id: ownerId,
    name: t.name,
    is_enabled: t.isEnabled ?? true,
    description: t.description,
    reward_name: t.rewardName,
    tagline: t.tagline ?? null,
    background_image: t.backgroundImage ?? null,
    background_opacity: t.backgroundOpacity ?? 100,
    logo_image: t.logoImage ?? null,
    show_logo: t.showLogo ?? true,
    title_size: t.titleSize ?? null,
    icon_key: t.iconKey,
    colors: t.colors,
    total_stamps: t.totalStamps,
    social: t.social ?? null,
  };
}

// GET /api/v1/campaigns
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const { data, error } = await db
    .from('campaigns')
    .select('*')
    .eq('owner_id', req.user!.id)
    .order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'Unable to fetch campaigns right now.' });
    return;
  }
  res.json((data ?? []).map(rowToCampaign));
});

// GET /api/v1/campaigns/count
router.get('/count', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const { count, error } = await db
    .from('campaigns')
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', req.user!.id);

  if (error) {
    res.status(500).json({ error: 'Unable to count campaigns.' });
    return;
  }
  res.json({ count: count ?? 0 });
});

// POST /api/v1/campaigns
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const row = campaignToRow(req.body, req.user!.id);
  const { error } = await db.from('campaigns').insert(row);
  if (error) {
    res.status(500).json({ error: 'Unable to create this campaign right now. Please try again.' });
    return;
  }
  res.status(201).json({ ok: true });
});

// PUT /api/v1/campaigns/:id — full update (Premium/Pro tier)
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const row = campaignToRow({ ...req.body, id: req.params.id }, req.user!.id);
  const { error } = await db.from('campaigns').upsert(row, { onConflict: 'id' });
  if (error) {
    res.status(500).json({ error: 'Unable to save this campaign right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

// PUT /api/v1/campaigns/:id/simple — restricted update for Standard/Popular tier
router.put('/:id/simple', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Fetch owner's tier
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('tier')
      .eq('id', req.user!.id)
      .single();

    if (profileError || !profile) {
      res.status(500).json({ error: 'Unable to verify account tier.' });
      return;
    }

    // Premium/Pro owners must use the full update endpoint
    if (profile.tier === 'premium' || profile.tier === 'pro') {
      res.status(403).json({ error: 'Use the full editor for Premium accounts.' });
      return;
    }

    // Only allow updating name, reward_name, total_stamps
    const { name, reward_name, total_stamps } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name (string) is required.' });
      return;
    }
    if (!reward_name || typeof reward_name !== 'string') {
      res.status(400).json({ error: 'reward_name (string) is required.' });
      return;
    }
    if (typeof total_stamps !== 'number' || total_stamps < 1) {
      res.status(400).json({ error: 'total_stamps (number >= 1) is required.' });
      return;
    }

    const db = supabaseForToken(req.user!.token);
    const { error } = await db
      .from('campaigns')
      .update({ name, reward_name, total_stamps })
      .eq('id', req.params.id)
      .eq('owner_id', req.user!.id);

    if (error) {
      res.status(500).json({ error: 'Unable to update campaign. Please try again.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unable to update campaign. Please try again.' });
  }
});

// PATCH /api/v1/campaigns/:id/toggle
router.patch('/:id/toggle', async (req: AuthenticatedRequest, res: Response) => {
  const { isEnabled } = req.body;
  if (typeof isEnabled !== 'boolean') {
    res.status(400).json({ error: 'isEnabled (boolean) is required' });
    return;
  }
  const db = supabaseForToken(req.user!.token);
  const { error } = await db
    .from('campaigns')
    .update({ is_enabled: isEnabled })
    .eq('id', req.params.id)
    .eq('owner_id', req.user!.id);

  if (error) {
    res.status(500).json({ error: 'Unable to update campaign status. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

// DELETE /api/v1/campaigns/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const { data, error } = await db.rpc('delete_campaign_preserve_cards', {
    campaign_id_input: req.params.id,
  });

  if (error) {
    res.status(500).json({ error: 'Unable to delete this campaign right now. Please try again.' });
    return;
  }
  if (typeof data === 'object' && data && 'success' in data && (data as { success?: boolean }).success === false) {
    res.status(500).json({ error: 'Unable to delete this campaign right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

export default router;
