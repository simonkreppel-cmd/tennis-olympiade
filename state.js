const { getClient } = require("./supabase");

// Builds the full public state (never includes adminCode) that the frontend
// renders from: config, players, games (with rules, limits, lock) and
// entries keyed by gameId -> playerId -> number | "foul".
async function loadPublicState() {
  const supabase = getClient();

  const [configRes, playersRes, gamesRes, entriesRes] = await Promise.all([
    supabase.from("config").select("key,value"),
    supabase.from("players").select("id,name").order("name", { ascending: true }),
    supabase
      .from("games")
      .select("id,name,unit,direction,sort_order,rules,hint,plan,min_value,max_value,allow_foul,locked")
      .order("sort_order", { ascending: true }),
    supabase.from("entries").select("game_id,player_id,value,is_foul"),
  ]);

  if (configRes.error) throw configRes.error;
  if (playersRes.error) throw playersRes.error;
  if (gamesRes.error) throw gamesRes.error;
  if (entriesRes.error) throw entriesRes.error;

  const configMap = {};
  (configRes.data || []).forEach((row) => {
    if (row.key === "adminCode") return; // never ship the admin code to any client
    configMap[row.key] = row.value;
  });

  const entriesByGame = {};
  (entriesRes.data || []).forEach((row) => {
    if (!entriesByGame[row.game_id]) entriesByGame[row.game_id] = {};
    entriesByGame[row.game_id][row.player_id] = row.is_foul ? "foul" : Number(row.value);
  });

  const games = (gamesRes.data || []).map((g) => ({
    id: g.id,
    name: g.name,
    unit: g.unit || "",
    direction: g.direction || "high",
    rules: g.rules || "",
    hint: g.hint || "",
    plan: g.plan || "",
    min: Number(g.min_value),
    max: Number(g.max_value),
    foul: !!g.allow_foul,
    locked: !!g.locked,
    entries: entriesByGame[g.id] || {},
  }));

  return {
    eventTitle: configMap.eventTitle || "Tennis-Olympiade",
    eventSub: configMap.eventSub || "",
    eventDate: configMap.eventDate || "",
    players: (playersRes.data || []).map((p) => ({ id: p.id, name: p.name })),
    games: games,
  };
}

async function checkAdminCode(code) {
  if (!code) return false;
  const supabase = getClient();
  // Goes through a SECURITY DEFINER RPC so the anon key never has a way to
  // actually read the admin code's value - only whether a guess matches it.
  const { data, error } = await supabase.rpc("check_admin_code", { input_code: String(code) });
  if (error) throw error;
  return !!data;
}

function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

module.exports = { loadPublicState, checkAdminCode, sendJson };
