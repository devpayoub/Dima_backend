import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { requireOwner } from '../middleware/requireOwner';
import { rowToCampaign, rowToTransaction, rowToIssuedCard } from '../utils/mappers';

const router = Router();
router.use(requireAuth as any, requireOwner as any);

// GET /api/v1/dashboard — Single endpoint for all initial owner data
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = req.db!;
  const ownerId = req.user!.id;

  const [campaignResult, customerResult, pendingResult] = await Promise.all([
    db.from('campaigns').select('*').eq('owner_id', ownerId).order('created_at', { ascending: true }),
    db.from('customers').select('*').eq('owner_id', ownerId).order('created_at', { ascending: true }),
    db.from('stamp_requests').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).eq('status', 'pending'),
  ]);

  if (campaignResult.error) {
    res.status(500).json({ error: 'Unable to fetch campaigns.' });
    return;
  }

  const campaigns = (campaignResult.data ?? []).map(rowToCampaign);

  if (customerResult.error) {
    res.status(500).json({ error: 'Unable to fetch customers.' });
    return;
  }

  const customerRows = customerResult.data ?? [];

  if (customerRows.length === 0) {
    res.json({ campaigns, customers: [], pendingRequestCount: pendingResult.count ?? 0 });
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

  const customers = customerRows.map((c: any) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    mobile: c.mobile,
    status: c.status,
    cards: cardsByCustomer[c.id] ?? [],
  }));

  res.json({ campaigns, customers, pendingRequestCount: pendingResult.count ?? 0 });
});

export default router;
