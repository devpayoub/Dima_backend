import { Router } from 'express';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin, supabaseAuth } from '../supabaseClient';
import { asyncHandler } from '../utils/asyncHandler';
import { parsePagination, paginatedResponse } from '../utils/pagination';
import crypto from 'crypto';

const router = Router();

// ─── Input Sanitizers ────────────────────────────────────────────────────────
function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

const ALLOWED_CAMPAIGN_UPDATE_FIELDS: string[] = [
  'name', 'description', 'reward_name', 'tagline', 'background_image',
  'background_opacity', 'logo_image', 'show_logo', 'title_size',
  'icon_key', 'total_stamps', 'social', 'mode', 'is_enabled', 'colors',
];

const ALLOWED_STATUS_FIELDS: string[] = ['status', 'access'];

function sanitizeCampaignUpdate(body: Record<string, unknown>) {
  return pick(body, ALLOWED_CAMPAIGN_UPDATE_FIELDS);
}

function sanitizeStatusUpdate(body: Record<string, unknown>) {
  return pick(body, ALLOWED_STATUS_FIELDS);
}

// Protect all admin routes
router.use(requireAuth, requireAdmin);

// Get platform stats
router.get('/stats', asyncHandler(async (_req, res) => {
  const [ownersResult, campaignsResult, cardsResult] = await Promise.all([
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'owner'),
    supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('issued_cards').select('*', { count: 'exact', head: true })
  ]);

  const { data: cards } = await supabaseAdmin
    .from('issued_cards')
    .select('stamps');
  const totalStamps = (cards ?? []).reduce((sum, c) => sum + (c.stamps ?? 0), 0);

  res.json({
    totalOwners: ownersResult.count || 0,
    totalCampaigns: campaignsResult.count || 0,
    totalIssuedCards: cardsResult.count || 0,
    totalStamps
  });
}));

// Get all non-admin owners (excludes staff and the logged-in admin)
router.get('/users', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, slug, tier, role, created_at, status, access, is_admin')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin /users] DB error:', error);
    throw error;
  }

  const adminId = req.user!.id;
  let filtered = (data ?? []).filter(p => p.role === 'owner');

  const search = req.query.search as string | undefined;
  if (search) {
    const term = search.toLowerCase();
    filtered = filtered.filter(p =>
      p.business_name?.toLowerCase().includes(term) ||
      p.email.toLowerCase().includes(term)
    );
  }

  const tier = req.query.tier as string | undefined;
  if (tier) {
    filtered = filtered.filter(p => p.tier === tier);
  }

  const status = req.query.status as string | undefined;
  if (status) {
    filtered = filtered.filter(p => p.status === status);
  }

  // Pagination (backward-compatible: no ?page param returns full array)
  if (req.query.page !== undefined) {
    const pagination = parsePagination(req);
    const total = filtered.length;
    const paginated = filtered.slice(pagination.offset, pagination.offset + pagination.limit);
    res.json(paginatedResponse(paginated, total, pagination));
  } else {
    res.json(filtered);
  }
}));

// Get single user details
router.get('/users/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) throw error;
  res.json(data);
}));

// Get staff for user
router.get('/users/:id/staff', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, role, created_at')
    .eq('owner_id', req.params.id)
    .eq('role', 'staff')
    .order('created_at', { ascending: false });

  if (error) throw error;
  res.json(data);
}));

// Get campaigns for user
router.get('/users/:id/campaigns', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, name, reward_name, total_stamps, is_enabled, mode, created_at')
    .eq('owner_id', req.params.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  res.json(data ?? []);
}));

// Get issued cards for user
router.get('/users/:id/issued-cards', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('issued_cards')
    .select('id, status, stamps, created_at, campaigns(name), customers(name, email)')
    .eq('owner_id', req.params.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  
  const cards = data.map((card: any) => ({
    ...card,
    customer_name: card.customers?.name || 'Unknown',
    customer_email: card.customers?.email || 'N/A',
    current_stamps: card.stamps,
    campaignName: card.campaigns?.name || 'Unknown'
  }));
  
  res.json(cards);
}));

// Create new owner user
router.post('/users', asyncHandler(async (req, res) => {
  const { email, password, business_name, slug, tier } = req.body;
  
  if (!email || !password || !business_name || !slug) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const { data, error } = await supabaseAuth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: 'owner',
      business_name,
      slug,
      tier
    }
  });

  if (error) throw error;
  
  if (tier && data.user) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const { error: updateError } = await supabaseAdmin.from('profiles').update({ tier }).eq('id', data.user.id);
    if (updateError) {
      console.error('[admin /users POST] Failed to update tier:', updateError);
    }
  }
  
  res.json(data.user);
}));

// Delete user
router.delete('/users/:id', asyncHandler(async (req, res) => {
  const { error } = await supabaseAuth.auth.admin.deleteUser(req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

// Change user password
router.put('/users/:id/password', asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }

  const { error } = await supabaseAuth.auth.admin.updateUserById(req.params.id, {
    password: password
  });
  
  if (error) throw error;
  res.json({ success: true });
}));

// Change user tier
router.put('/users/:id/tier', asyncHandler(async (req, res) => {
  const { tier } = req.body;
  const validTiers = ['free', 'standard', 'popular', 'premium', 'pro'];
  if (!tier || !validTiers.includes(tier)) {
    res.status(400).json({ error: `Tier must be one of: ${validTiers.join(', ')}` });
    return;
  }

  const { error } = await supabaseAdmin.from('profiles').update({ tier }).eq('id', req.params.id);
  
  if (error) throw error;
  res.json({ success: true });
}));

// Create campaign for user
router.post('/users/:id/campaigns', asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const { data: profile } = await supabaseAdmin.from('profiles').select('tier').eq('id', userId).single();
  if (!profile) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  
  const { count } = await supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }).eq('owner_id', userId);
  const limit = profile.tier === 'premium' ? 3 : 1;
  if (count !== null && count >= limit) {
    res.status(400).json({ error: `Campaign limit reached for ${profile.tier} tier (${limit})` });
    return;
  }

  const campaignData = {
    ...sanitizeCampaignUpdate(req.body),
    owner_id: userId
  };

  const { data, error } = await supabaseAdmin.from('campaigns').insert(campaignData).select().single();
  if (error) throw error;
  res.json(data);
}));

// Get single campaign
router.get('/campaigns/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('campaigns').select('*').eq('id', req.params.id).single();
  if (error) throw error;
  res.json(data);
}));

// Update campaign
router.put('/campaigns/:id', asyncHandler(async (req, res) => {
  const sanitized = sanitizeCampaignUpdate(req.body);
  const { data, error } = await supabaseAdmin.from('campaigns').update(sanitized).eq('id', req.params.id).select().single();
  if (error) throw error;
  res.json(data);
}));

// Delete campaign
router.delete('/campaigns/:id', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('campaigns').delete().eq('id', req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

// Update user status/access
router.patch('/users/:id/status', asyncHandler(async (req, res) => {
  const updates = sanitizeStatusUpdate(req.body);

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  const { error } = await supabaseAdmin.from('profiles').update(updates).eq('id', req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

// Toggle campaign enabled/disabled
router.patch('/campaigns/:id/toggle', asyncHandler(async (req, res) => {
  const { isEnabled } = req.body;
  if (typeof isEnabled !== 'boolean') {
    res.status(400).json({ error: 'isEnabled (boolean) is required' });
    return;
  }

  const { error } = await supabaseAdmin
    .from('campaigns')
    .update({ is_enabled: isEnabled })
    .eq('id', req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

// Get license keys for user
router.get('/users/:id/license-keys', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('license_keys')
    .select('id, license_key, platform, status, activated_at, expires_at, created_at')
    .eq('profile_id', req.params.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  res.json(data ?? []);
}));

// Create license key for user
router.post('/users/:id/license-keys', asyncHandler(async (req, res) => {
  const { platform } = req.body;
  const licenseKey = `STMP-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const { data, error } = await supabaseAdmin
    .from('license_keys')
    .insert({
      profile_id: req.params.id,
      license_key: licenseKey,
      platform: platform || 'manual',
      status: 'active'
    })
    .select()
    .single();

  if (error) throw error;
  res.json(data);
}));

// Revoke/delete license key
router.delete('/license-keys/:id', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from('license_keys')
    .delete()
    .eq('id', req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

export default router;
