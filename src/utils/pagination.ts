import type { Request } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export function parsePagination(req: Request): PaginationParams {
  const rawPage = parseInt(req.query.page as string, 10);
  const rawLimit = parseInt(req.query.limit as string, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function paginatedResponse<T>(data: T[], total: number, params: PaginationParams): PaginatedResponse<T> {
  return { data, total, page: params.page, limit: params.limit };
}
