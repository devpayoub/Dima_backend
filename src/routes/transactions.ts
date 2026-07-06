import { Router, Response } from 'express';
import { supabaseForToken } from '../supabaseClient';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { rowToTransaction } from '../utils/mappers';

const router = Router();
router.use(requireAuth as any);

// POST /api/v1/transactions — Add a transaction to a card
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const { cardId, transaction } = req.body;
  if (!cardId || !transaction) {
    res.status(400).json({ error: 'cardId and transaction are required' });
    return;
  }

  const db = supabaseForToken(req.user!.token);
  const { error } = await db.from('transactions').insert({
    id: transaction.id,
    card_id: cardId,
    type: transaction.type,
    amount: transaction.amount,
    date: transaction.date,
    timestamp: transaction.timestamp,
    title: transaction.title,
    remarks: transaction.remarks ?? null,
    actor_id: transaction.actorId ?? null,
    actor_name: transaction.actorName ?? null,
    actor_role: transaction.actorRole ?? null,
  });

  if (error) {
    res.status(500).json({ error: 'Unable to save this activity right now. Please try again.' });
    return;
  }
  res.status(201).json({ ok: true });
});

// GET /api/v1/transactions — List all transactions for the owner's cards
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = supabaseForToken(req.user!.token);
  const ownerId = req.user!.role === 'owner' ? req.user!.id : req.user!.ownerId;

  // Get card IDs for this owner first
  const { data: cards } = await db
    .from('issued_cards')
    .select('id')
    .eq('owner_id', ownerId);

  if (!cards || cards.length === 0) {
    res.json([]);
    return;
  }

  const cardIds = cards.map((c: { id: string }) => c.id);
  const { data, error } = await db
    .from('transactions')
    .select('*')
    .in('card_id', cardIds)
    .order('timestamp', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Unable to fetch transactions right now.' });
    return;
  }
  res.json((data ?? []).map(rowToTransaction));
});

export default router;
