import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Route modules
import authRouter from './routes/auth';
import profileRouter from './routes/profile';
import campaignsRouter from './routes/campaigns';
import customersRouter from './routes/customers';
import issuedCardsRouter from './routes/issuedCards';
import transactionsRouter from './routes/transactions';
import staffRouter from './routes/staff';
import publicRouter from './routes/public';
import adminRouter from './routes/admin';

const app = express();
const port = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:4000'],
  credentials: true,
}));
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/profile', profileRouter);
app.use('/api/v1/campaigns', campaignsRouter);
app.use('/api/v1/customers', customersRouter);
app.use('/api/v1/issued-cards', issuedCardsRouter);
app.use('/api/v1/transactions', transactionsRouter);
app.use('/api/v1/staff', staffRouter);
app.use('/api/v1/public', publicRouter);
app.use('/api/v1/admin', adminRouter);

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ─── 404 catch-all ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`\n🚀  Stampee API running → http://localhost:${port}/api/v1`);
  console.log(`   Health check → http://localhost:${port}/api/v1/health\n`);
});
