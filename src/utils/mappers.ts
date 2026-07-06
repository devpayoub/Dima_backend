export function rowToProfile(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    businessName: row.business_name,
    email: row.email,
    slug: row.slug,
    role: row.role,
    ownerId: row.owner_id,
    status: row.status,
    access: row.access,
    tier: row.tier ?? 'free',
    tierExpiresAt: row.tier_expires_at,
    createdAt: row.created_at,
  };
}

export function rowToTransaction(t: any) {
  return {
    id: t.id,
    type: t.type,
    amount: t.amount,
    date: t.date,
    timestamp: t.timestamp,
    title: t.title,
    remarks: t.remarks,
    actorId: t.actor_id,
    actorName: t.actor_name,
    actorRole: t.actor_role,
  };
}

export function rowToCampaign(row: any) {
  return {
    id: row.id,
    name: row.name,
    isEnabled: row.is_enabled,
    description: row.description,
    rewardName: row.reward_name,
    tagline: row.tagline,
    backgroundImage: row.background_image,
    backgroundOpacity: row.background_opacity,
    logoImage: row.logo_image,
    showLogo: row.show_logo,
    titleSize: row.title_size,
    iconKey: row.icon_key,
    colors: row.colors,
    totalStamps: row.total_stamps,
    social: row.social,
  };
}

export function rowToIssuedCard(row: any, history?: any[]) {
  return {
    id: row.id,
    uniqueId: row.unique_id,
    customerId: row.customer_id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    stamps: row.stamps,
    lastVisit: row.last_visit,
    status: row.status,
    completedDate: row.completed_date,
    templateSnapshot: row.template_snapshot,
    history: history ?? (row.transactions ?? []).map(rowToTransaction),
  };
}
