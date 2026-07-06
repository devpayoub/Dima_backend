import { Router, Response } from 'express';
import { supabaseForToken } from '../supabaseClient';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { rowToTransaction, rowToIssuedCard } from '../utils/mappers';

const router = Router();
router.use(requireAuth as any);

// GET /api/v1/customers — list with issued cards + transaction history
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const ownerId = req.user!.role === 'owner' ? req.user!.id : req.user!.ownerId;

  const { data: customerRows, error: cErr } = await db
    .from('customers')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true });

  if (cErr) {
    res.status(500).json({ error: 'Unable to fetch customers right now.' });
    return;
  }

  if (!customerRows || customerRows.length === 0) {
    res.json([]);
    return;
  }

  const customerIds = customerRows.map((c: { id: string }) => c.id);

  const { data: cardRows } = await db
    .from('issued_cards')
    .select('*')
    .in('customer_id', customerIds);

  const cardIds = (cardRows ?? []).map((r: { id: string }) => r.id);

  let txMap: Record<string, any[]> = {};
  if (cardIds.length > 0) {
    const { data: txRows } = await db
      .from('transactions')
      .select('*')
      .in('card_id', cardIds)
      .order('timestamp', { ascending: true });

    for (const t of txRows ?? []) {
      txMap[t.card_id] = txMap[t.card_id] ?? [];
      txMap[t.card_id].push(rowToTransaction(t));
    }
  }

  const cardsByCustomer: Record<string, any[]> = {};
  for (const r of cardRows ?? []) {
    cardsByCustomer[r.customer_id] = cardsByCustomer[r.customer_id] ?? [];
    cardsByCustomer[r.customer_id].push(rowToIssuedCard(r, txMap[r.id] ?? []));
  }

  const result = customerRows.map((c: any) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    mobile: c.mobile,
    status: c.status,
    cards: cardsByCustomer[c.id] ?? [],
  }));

  res.json(result);
});

// POST /api/v1/customers
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const ownerId = req.user!.role === 'owner' ? req.user!.id : req.user!.ownerId;
  const { id, name, email, mobile, status } = req.body;

  const { error } = await db.from('customers').insert({
    id,
    name,
    email,
    mobile,
    status: status ?? 'Active',
    owner_id: ownerId
  });

  if (error) {
    res.status(500).json({ error: 'Unable to save this customer right now. Please try again.' });
    return;
  }
  res.status(201).json({ ok: true });
});

// PUT /api/v1/customers/:id
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const ownerId = req.user!.role === 'owner' ? req.user!.id : req.user!.ownerId;
  const { name, email, mobile, status } = req.body;

  const { error } = await db
    .from('customers')
    .upsert({
      id: req.params.id,
      name,
      email,
      mobile,
      status: status ?? 'Active',
      owner_id: ownerId
    }, { onConflict: 'id' });

  if (error) {
    res.status(500).json({ error: 'Unable to save this customer right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

// PATCH /api/v1/customers/:id/status
router.patch('/:id/status', async (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.body;
  if (status !== 'Active' && status !== 'Inactive') {
    res.status(400).json({ error: "status must be 'Active' or 'Inactive'" });
    return;
  }
  const db = supabaseForToken(req.user!.token);
  const { error } = await db
    .from('customers')
    .update({ status })
    .eq('id', req.params.id);
  if (error) {
    res.status(500).json({ error: 'Unable to update this customer right now. Please try again.' });
    return;
  }
  res.json({ ok: true });
});

export default router;
