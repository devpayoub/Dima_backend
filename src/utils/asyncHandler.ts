import { Request, Response, NextFunction } from 'express';

export const asyncHandler = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) =>
    fn(req, res).catch((err: any) => {
      res.status(500).json({ error: err.message });
    });
