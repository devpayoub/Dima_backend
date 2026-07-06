import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, business_name, slug, tier, role, created_at, is_admin, status')
    .eq('role', 'owner')
    .or('is_admin.eq.false,is_admin.is.null');

  if (error) console.error(error);
  console.log('Result count:', data?.length);
  console.log(JSON.stringify(data, null, 2));
}

test();
