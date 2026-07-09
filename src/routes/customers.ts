import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { rowToTransaction, rowToIssuedCard } from '../utils/mappers';
import { resolveOwnerId } from '../utils/auth';
import { parsePagination, paginatedResponse, type PaginationParams } from '../utils/pagination';

const router = Router();
router.use(requireAuth as any);

// GET /api/v1/customers — list with issued cards + transaction history
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = req.db!;
  const ownerId = resolveOwnerId(req.user!);

  const { data: customerRows, error: cErr } = await db
    .from('customers')
    .select(`
      *,
      issued_cards (
        *,
        transactions (*)
      )
    `)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true });

  if (cErr) {
    res.status(500).json({ error: 'Unable to fetch customers right now.' });
    return;
  }

  if (!customerRows || customerRows.length === 0) {
    res.json(req.query.page !== undefined ? paginatedResponse([], 0, parsePagination(req)) : []);
    return;
  }

  // Format the nested response for the frontend
  const result = customerRows.map((c: any) => {
    // Supabase nested joins return arrays, but just in case, default to empty array
    const cards = Array.isArray(c.issued_cards) ? c.issued_cards : [];
    
    // Sort transactions if they exist inside the nested cards, since we couldn't easily order nested relations in one go in standard PostgREST without an order query inside the select string, but we can do it in memory.
    const mappedCards = cards.map((card: any) => {
       const txs = Array.isArray(card.transactions) ? card.transactions : [];
       txs.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
       return rowToIssuedCard(card, txs.map(rowToTransaction));
    });

    return {
      id: c.id,
      name: c.name,
      email: c.email,
      mobile: c.mobile,
      status: c.status,
      cards: mappedCards,
    };
  });

  // Pagination (backward-compatible: no ?page param returns full array)
  if (req.query.page !== undefined) {
    const pagination = parsePagination(req);
    const total = result.length;
    const paginated = result.slice(pagination.offset, pagination.offset + pagination.limit);
    res.json(paginatedResponse(paginated, total, pagination));
  } else {
    res.json(result);
  }
});

// POST /api/v1/customers
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const db = req.db!;
  const ownerId = resolveOwnerId(req.user!);
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
  const db = req.db!;
  const ownerId = resolveOwnerId(req.user!);
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
  const db = req.db!;
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
