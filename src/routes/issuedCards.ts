import { Router, Response } from 'express';
import { supabaseForToken } from '../supabaseClient';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../supabaseClient';
import { rowToTransaction, rowToIssuedCard } from '../utils/mappers';

const router = Router();
router.use(requireAuth as any);

// GET /api/v1/issued-cards/count
router.get('/count', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const ownerId = req.user!.role === 'owner' ? req.user!.id : req.user!.ownerId;
  const { count, error } = await db
    .from('issued_cards')
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', ownerId);
  if (error) {
    res.status(500).json({ error: 'Unable to count issued cards.' });
    return;
  }
  res.json({ count: count ?? 0 });
});

// GET /api/v1/issued-cards
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const ownerId = req.user!.role === 'owner' ? req.user!.id : req.user!.ownerId;
  const { data, error } = await db
    .from('issued_cards')
    .select('*, transactions(*)')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Unable to fetch issued cards right now.' });
    return;
  }
  res.json((data ?? []).map(row => rowToIssuedCard(row)));
});

// POST /api/v1/issued-cards — Issue a new card
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const ownerId = req.user!.role === 'owner' ? req.user!.id : req.user!.ownerId;
  const { id, uniqueId, customerId, campaignId, campaignName, templateSnapshot, stamps, status } = req.body;

  // Enforce tier limits
  const { data: profile } = await supabaseAdmin.from('profiles').select('tier').eq('id', ownerId).single();
  if (profile && (profile.tier === 'standard' || profile.tier === 'free')) {
    const { count } = await supabaseAdmin.from('issued_cards').select('*', { count: 'exact', head: true }).eq('owner_id', ownerId);
    const limit = profile.tier === 'standard' ? 300 : 50;
    if (count !== null && count >= limit) {
      res.status(400).json({ error: `Plan limit reached: You can only issue up to ${limit} cards on the ${profile.tier} plan.` });
      return;
    }
  }

  const { error } = await db.from('issued_cards').insert({
    id,
    unique_id: uniqueId,
    customer_id: customerId,
    campaign_id: campaignId,
    campaign_name: campaignName,
    template_snapshot: templateSnapshot ?? null,
    owner_id: ownerId,
    stamps: stamps ?? 0,
    last_visit: new Date().toISOString().split('T')[0],
    status: status ?? 'Active',
  });

  if (error) {
    if (error.message.includes('CAMPAIGN_DISABLED')) {
      res.status(400).json({ error: 'This campaign is disabled and cannot issue new cards.' });
      return;
    }
    res.status(500).json({ error: 'Unable to issue this card right now. Please try again.' });
    return;
  }
  res.status(201).json({ ok: true });
});

// PATCH /api/v1/issued-cards/:id — Update stamps, status, etc.
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const updates: Record<string, unknown> = {};
  if (req.body.stamps !== undefined) updates.stamps = req.body.stamps;
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.completedDate !== undefined) updates.completed_date = req.body.completedDate;
  if (req.body.lastVisit !== undefined) updates.last_visit = req.body.lastVisit;

  const { error } = await db.from('issued_cards').update(updates).eq('id', req.params.id);
  if (error) {
    res.status(500).json({ error: 'Unable to update this card right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

// DELETE /api/v1/issued-cards/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const { error } = await db.from('issued_cards').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ error: 'Unable to revoke this card right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

// POST /api/v1/issued-cards/inspect — Inspect scanned QR card
router.post('/inspect', async (req: AuthenticatedRequest, res: Response) => {
  const { uniqueId } = req.body;
  if (!uniqueId) {
    res.status(400).json({ error: 'uniqueId is required' });
    return;
  }
  const db = supabaseForToken(req.user!.token);
  const { data, error } = await db.rpc('inspect_scanned_card', { card_unique_id: uniqueId });
  if (error) {
    res.status(500).json({ status: 'missing', error: 'Unable to validate this card right now.' });
    return;
  }
  res.json({ status: data });
});

export default router;
