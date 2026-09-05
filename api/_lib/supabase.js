const { createClient } = require("@supabase/supabase-js");

// This is the public anon/publishable key for the Tennis-Olympiade Supabase
// project, not a secret: it is meant to be embedded in client-side code and
// is safe to be public. All real access control is enforced in Postgres
// itself via Row Level Security policies and SECURITY DEFINER RPCs for the
// admin-gated writes (see supabase_schema.sql) - this key on its own cannot
// read the admin code or bypass any of that.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://yjlgoohgevpvptbxlroo.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_q_Nrl1dti9ufqI9MThEv5Q_tsfLbqMB";

let client = null;
function getClient() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  }
  return client;
}

module.exports = { getClient };
