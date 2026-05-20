const { createClient } = require("@supabase/supabase-js");
const { supabase: supabaseConfig } = require("./env");

let client = null;

function getSupabaseClient() {
  if (client) return client;
  if (!supabaseConfig.url || !supabaseConfig.serviceKey) {
    throw new Error(
      "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in your environment."
    );
  }
  client = createClient(supabaseConfig.url, supabaseConfig.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

module.exports = { getSupabaseClient, logoBucket: supabaseConfig.logoBucket };
