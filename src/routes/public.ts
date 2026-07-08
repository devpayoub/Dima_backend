import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../supabaseClient';
import { resolveOwnerIdFromSlug } from '../utils/auth';

const router = Router();

const REWARD_CODES = [
  'STAMP10', 'COOKIE30', 'SWEET15', 'LOVE20', 'FREE25',
  'TREAT12', 'BONUS18', 'VIP22', 'FUN8', 'JOY14',
];
const REWARD_MESSAGES = [
  "You're one smart cookie! Enjoy your discount.",
  "You came, you saw, you conquered. Claim your prize, champ!",
  "You're one sharp tack! Thanks for sticking with us—enjoy your treat.",
  "Precision pays off. You've successfully navigated your way to a free reward. Well played.",
  "You've officially figured out the secret to winning. Your reward is ready and waiting.",
  "You make this look easy. Your loyalty card is full and your reward is unlocked. Stay sharp.",
  "Sharp choice. Enjoy your well-earned treat.",
  "Stamps full. Logic wins. Enjoy!",
  "You've got the system down. Reward ready!",
  "Savvy shopper, sweet reward. It's yours!",
];
function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// GET /api/v1/public/reward
router.get('/reward', (_req: Request, res: Response) => {
  res.json({ code: randomItem(REWARD_CODES), message: randomItem(REWARD_MESSAGES) });
});

// GET /api/v1/public/card/:slug/:uniqueId — Public card view
router.get('/card/:slug/:uniqueId', async (req: Request, res: Response) => {
  const { slug, uniqueId } = req.params;
  const { data, error } = await supabaseAdmin.rpc('get_public_card', {
    slug_input: slug,
    card_unique_id: uniqueId,
  });
  if (error || !data) {
    res.status(404).json({ error: 'Card not found' });
    return;
  }
  res.json(data);
});

// GET /api/v1/public/campaign/:slug/:campaignId — Campaign signup context
router.get('/campaign/:slug/:campaignId', async (req: Request, res: Response) => {
  const { slug, campaignId } = req.params;
  const { data, error } = await supabaseAdmin.rpc('get_public_campaign_signup_context', {
    slug_input: slug,
    campaign_id_input: campaignId,
  });
  if (error || !data || typeof data !== 'object') {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  res.json(data);
});

// POST /api/v1/public/campaign/:slug/:campaignId/signup — Register campaign signup
router.post('/campaign/:slug/:campaignId/signup', async (req: Request, res: Response) => {
  const { slug, campaignId } = req.params;
  const { name, email, mobile } = req.body;

  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc('register_public_campaign_signup', {
    slug_input: slug,
    campaign_id_input: campaignId,
    customer_name_input: name,
    customer_email_input: email ?? '',
    customer_mobile_input: mobile ?? '',
  });

  if (error || !data || typeof data !== 'object') {
    res.status(500).json({ error: 'Unable to complete signup right now. Please try again.' });
    return;
  }

  res.json(data);
});

// GET /api/v1/public/customer/:slug/:phone — Look up customer by phone
router.get('/customer/:slug/:phone', async (req: Request, res: Response) => {
  const { slug, phone } = req.params;

  if (!phone || phone.trim().length === 0) {
    res.status(400).json({ error: 'Phone number is required' });
    return;
  }

  // Resolve owner_id from slug
  const ownerResult = await resolveOwnerIdFromSlug(slug);
  if ('error' in ownerResult) {
    res.status(ownerResult.status).json({ error: ownerResult.error });
    return;
  }
  const ownerId = ownerResult.ownerId;

  const { data: customer, error } = await supabaseAdmin
    .from('customers')
    .select('id, name, email, mobile')
    .eq('owner_id', ownerId)
    .eq('mobile', phone.trim())
    .maybeSingle();

  if (error || !customer) {
    res.json({ found: false });
    return;
  }

  res.json({ found: true, name: customer.name, email: customer.email, mobile: customer.mobile });
});

// GET /api/v1/public/scan/:slug/:uniqueId — Scan entry context
router.get('/scan/:slug/:uniqueId', async (req: Request, res: Response) => {
  const { slug, uniqueId } = req.params;
  const { data, error } = await supabaseAdmin.rpc('get_scan_entry_context', {
    slug_input: slug,
    card_unique_id: uniqueId,
  });
  if (error || !data || typeof data !== 'object') {
    res.status(404).json({ error: 'Scan context not found' });
    return;
  }
  res.json(data);
});

export default router;
