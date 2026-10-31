const SUPABASE_URL = "https://vhfuwqfqbcbqeksjruzu.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_P26tMwkoTtxUUeq9tZ-DOQ_Ga-TjnHc";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage
    }
  }
);