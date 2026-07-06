import { Router, Response } from 'express';
import { supabaseForToken } from '../supabaseClient';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { requireOwner } from '../middleware/requireOwner';
import { rowToProfile } from '../utils/mappers';

const router = Router();
router.use(requireAuth as any, requireOwner as any);

// GET /api/v1/staff
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('owner_id', req.user!.id)
    .eq('role', 'staff');
  if (error) {
    res.status(500).json({ error: 'Unable to fetch staff accounts right now.' });
    return;
  }
  res.json((data ?? []).map(rowToProfile));
});

// POST /api/v1/staff — Create a new staff account
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const { email, pin, name } = req.body;
  if (!email || !pin || !name) {
    res.status(400).json({ error: 'email, pin, and name are required' });
    return;
  }
  if (!/^\d{4,6}$/.test(pin)) {
    res.status(400).json({ error: 'PIN must be 4-6 digits' });
    return;
  }

  // Use the RPC which handles auth.users + profiles insert atomically
  const db = supabaseForToken(req.user!.token);
  const { error } = await db.rpc('create_staff_account', {
    staff_email: email.trim().toLowerCase(),
    staff_pin: pin,
    staff_name: name.trim(),
  });

  if (error) {
    if (error.message.includes('Email already in use')) {
      res.status(409).json({ error: 'This email is already in use.' });
      return;
    }
    res.status(500).json({ error: 'Unable to create staff account right now. Please try again.' });
    return;
  }
  res.status(201).json({ ok: true });
});

// PATCH /api/v1/staff/:id/pin — Update staff PIN
router.patch('/:id/pin', async (req: AuthenticatedRequest, res: Response) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4,6}$/.test(pin)) {
    res.status(400).json({ error: 'PIN must be 4-6 digits' });
    return;
  }

  const db = supabaseForToken(req.user!.token);
  const { error } = await db.rpc('update_staff_pin', {
    staff_id: req.params.id,
    new_pin: pin,
  });

  if (error) {
    res.status(500).json({ error: 'Unable to update staff PIN right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

// PATCH /api/v1/staff/:id/access — Enable or disable a staff account
router.patch('/:id/access', async (req: AuthenticatedRequest, res: Response) => {
  const { access } = req.body;
  if (access !== 'active' && access !== 'disabled') {
    res.status(400).json({ error: "access must be 'active' or 'disabled'" });
    return;
  }

  const db = supabaseForToken(req.user!.token);
  const { error } = await db
    .from('profiles')
    .update({ access })
    .eq('id', req.params.id)
    .eq('owner_id', req.user!.id);

  if (error) {
    res.status(500).json({ error: 'Unable to update staff access right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

// DELETE /api/v1/staff/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const { error } = await db.rpc('delete_staff_account', { staff_id: req.params.id });
  if (error) {
    res.status(500).json({ error: 'Unable to delete staff account right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

export default router;
