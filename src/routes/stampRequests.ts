import { Router, Response } from 'express';
import { supabaseAdmin } from '../supabaseClient';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { resolveOwnerIdFromSlug } from '../utils/auth';
import { rowToStampRequest } from '../utils/mappers';

const router = Router();

// POST /api/v1/stamp-requests — Customer creates a request (no auth)
router.post('/', async (req, res: Response) => {
  const { ownerSlug, campaignId, customerName, customerPhone, customerEmail } = req.body;

  if (!ownerSlug || !campaignId || !customerName || !customerPhone) {
    res.status(400).json({ error: 'ownerSlug, campaignId, customerName, and customerPhone are required' });
    return;
  }

  // Resolve owner_id from slug
  const ownerResult = await resolveOwnerIdFromSlug(ownerSlug);
  if ('error' in ownerResult) {
    res.status(ownerResult.status).json({ error: ownerResult.error });
    return;
  }
  const ownerId = ownerResult.ownerId;

  // Check for duplicate pending request (same phone + campaign)
  const { data: existing } = await supabaseAdmin
    .from('stamp_requests')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('customer_phone', customerPhone)
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .maybeSingle();

  if (existing) {
    res.status(409).json({ error: 'You already have a pending request for this campaign' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('stamp_requests')
    .insert({
      owner_id: ownerId,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: customerEmail || '',
      campaign_id: campaignId,
    })
    .select()
    .single();

  if (error || !data) {
    res.status(500).json({ error: 'Unable to create request' });
    return;
  }

  res.json({ requestId: data.id });
});

// GET /api/v1/stamp-requests — Owner fetches their pending requests
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  // Auto-expire old requests
  await supabaseAdmin.rpc('expire_old_stamp_requests', {
    owner_id_input: req.user!.id,
  });

  const { data, error } = await supabaseAdmin
    .from('stamp_requests')
    .select(`
      id,
      customer_name,
      customer_phone,
      customer_email,
      campaign_id,
      status,
      accepted_card_id,
      created_at,
      updated_at,
      campaigns!inner(name)
    `)
    .eq('owner_id', req.user!.id)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch requests' });
    return;
  }

  const requests = (data || []).map(rowToStampRequest);

  res.json(requests);
});

// POST /api/v1/stamp-requests/:id/accept — Owner accepts a request
router.post('/:id/accept', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin.rpc('accept_stamp_request', {
    request_id_input: id,
    owner_id_input: req.user!.id,
  });

  if (error) {
    res.status(500).json({ error: 'Failed to accept request' });
    return;
  }

  if (data?.error) {
    res.status(400).json({ error: data.error });
    return;
  }

  res.json(data);
});

// POST /api/v1/stamp-requests/:id/decline — Owner declines a request
router.post('/:id/decline', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin.rpc('decline_stamp_request', {
    request_id_input: id,
    owner_id_input: req.user!.id,
  });

  if (error) {
    res.status(500).json({ error: 'Failed to decline request' });
    return;
  }

  res.json(data);
});

export default router;
