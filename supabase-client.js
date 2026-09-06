// ─── SUPABASE CLIENT ───
// 🔧 Fill these in from your Supabase dashboard → Settings → API
//    - SUPABASE_URL: the "Project URL" (looks like https://xxxxx.supabase.co)
//    - SUPABASE_ANON_KEY: the "anon public" key (safe for browser use — NOT the service_role key)
const SUPABASE_URL = 'https://njnzsdsoijhtpntbibvc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ivAyimyNjO5cIBgfGURnHA_JMprvurh';

// Named "sb" (not "supabase") to avoid colliding with the supabase-js library's own
// global namespace, which is what exposes window.supabase.createClient below.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
