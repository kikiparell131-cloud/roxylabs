import {createClient} from '@supabase/supabase-js';
let client:ReturnType<typeof createClient>|null=null;
export function getSupabase(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)throw new Error('Supabase frontend environment variables are missing.');
 if(!client)client=createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 return client;
}
export async function getAccessToken(){const {data}=await getSupabase().auth.getSession();return data.session?.access_token||null;}
