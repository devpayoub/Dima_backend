import { Router } from 'express';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin, supabaseAuth } from '../supabaseClient';
import crypto from 'crypto';

const router = Router();

// Protect all admin routes
router.use(requireAuth, requireAdmin);

// Get platform stats
router.get('/stats', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [ownersResult, campaignsResult, cardsResult] = await Promise.all([
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'owner'),
      supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('issued_cards').select('*', { count: 'exact', head: true })
    ]);

    // Sum stamps across all issued_cards
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all non-admin owners (excludes staff and the logged-in admin)
router.get('/users', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, business_name, slug, tier, role, created_at, status, access, is_admin')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[admin /users] DB error:', error);
      throw error;
    }

    // Filter in JS: only owners, exclude the currently logged-in admin
    const adminId = req.user!.id;
    let filtered = (data ?? []).filter(p => p.role === 'owner' && p.id !== adminId);

    // Apply search filter (case-insensitive on name or email)
    const search = req.query.search as string | undefined;
    if (search) {
      const term = search.toLowerCase();
      filtered = filtered.filter(p =>
        p.business_name?.toLowerCase().includes(term) ||
        p.email.toLowerCase().includes(term)
      );
    }

    // Apply tier filter
    const tier = req.query.tier as string | undefined;
    if (tier) {
      filtered = filtered.filter(p => p.tier === tier);
    }

    // Apply status filter
    const status = req.query.status as string | undefined;
    if (status) {
      filtered = filtered.filter(p => p.status === status);
    }

    res.json(filtered);
  } catch (err: any) {
    console.error('[admin /users] Exception:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get single user details
router.get('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get staff for user
router.get('/users/:id/staff', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, business_name, role, created_at')
      .eq('owner_id', req.params.id)
      .eq('role', 'staff')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get campaigns for user
router.get('/users/:id/campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, reward_name, total_stamps, is_enabled, mode, created_at')
      .eq('owner_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get issued cards for user
router.get('/users/:id/issued-cards', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('issued_cards')
      .select('id, status, stamps, created_at, campaigns(name), customers(name, email)')
      .eq('owner_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Flatten relations for easier table rendering
    const cards = data.map((card: any) => ({
      ...card,
      customer_name: card.customers?.name || 'Unknown',
      customer_email: card.customers?.email || 'N/A',
      current_stamps: card.stamps,
      campaignName: card.campaigns?.name || 'Unknown'
    }));
    
    res.json(cards);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create new owner user
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, password, business_name, slug, tier } = req.body;
    
    if (!email || !password || !business_name || !slug) {
      return res.status(400).json({ error: 'Missing required fields' });
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
      // Add a small delay so trigger has time to commit and PostgREST schema cache to update
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { error: updateError } = await supabaseAdmin.from('profiles').update({ tier }).eq('id', data.user.id);
      if (updateError) {
        console.error('[admin /users POST] Failed to update tier:', updateError);
      }
    }
    
    res.json(data.user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabaseAuth.auth.admin.deleteUser(req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Change user password
router.put('/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const { error } = await supabaseAuth.auth.admin.updateUserById(req.params.id, {
      password: password
    });
    
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Change user tier
router.put('/users/:id/tier', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { tier } = req.body;
    if (!tier) {
      return res.status(400).json({ error: 'Tier is required' });
    }

    const { error } = await supabaseAdmin.from('profiles').update({ tier }).eq('id', req.params.id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create campaign for user
router.post('/users/:id/campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    // Check tier limits
    const { data: profile } = await supabaseAdmin.from('profiles').select('tier').eq('id', userId).single();
    if (!profile) return res.status(404).json({ error: 'User not found' });
    
    const { count } = await supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }).eq('owner_id', userId);
    const limit = profile.tier === 'premium' ? 3 : 1;
    if (count !== null && count >= limit) {
      return res.status(400).json({ error: `Campaign limit reached for ${profile.tier} tier (${limit})` });
    }

    const campaignData = {
      ...req.body,
      owner_id: userId
    };

    const { data, error } = await supabaseAdmin.from('campaigns').insert(campaignData).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single campaign
router.get('/campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('campaigns').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update campaign
router.put('/campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('campaigns').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete campaign
router.delete('/campaigns/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('campaigns').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update user status/access
router.patch('/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, access } = req.body;
    const updates: Record<string, string> = {};
    if (status) updates.status = status;
    if (access) updates.access = access;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { error } = await supabaseAdmin.from('profiles').update(updates).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle campaign enabled/disabled
router.patch('/campaigns/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { isEnabled } = req.body;
    if (typeof isEnabled !== 'boolean') {
      return res.status(400).json({ error: 'isEnabled (boolean) is required' });
    }

    const { error } = await supabaseAdmin
      .from('campaigns')
      .update({ is_enabled: isEnabled })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get license keys for user
router.get('/users/:id/license-keys', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('license_keys')
      .select('id, license_key, platform, status, activated_at, expires_at, created_at')
      .eq('profile_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create license key for user
router.post('/users/:id/license-keys', requireAuth, requireAdmin, async (req, res) => {
  try {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke/delete license key
router.delete('/license-keys/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('license_keys')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
