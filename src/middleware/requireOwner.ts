import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

export function requireOwner(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || req.user.role !== 'owner') {
    res.status(403).json({ error: 'This action is restricted to owners only' });
    return;
  }
  next();
}
