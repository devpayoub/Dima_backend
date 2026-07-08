import { supabaseAdmin } from '../supabaseClient';

export function resolveOwnerId(user: { role: string; id: string; ownerId?: string }): string {
  return user.role === 'owner' ? user.id : user.ownerId!;
}

export async function resolveOwnerIdFromSlug(slug: string): Promise<{ ownerId: string } | { error: string; status: number }> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('slug', slug)
    .single();

  if (error || !data) return { error: 'Business not found', status: 404 };
  return { ownerId: data.id };
}
