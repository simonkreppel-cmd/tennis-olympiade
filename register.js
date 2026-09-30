const { getClient } = require("./_lib/supabase");
const { loadPublicState, sendJson } = require("./_lib/state");

function normalizeKey(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "method_not_allowed" });
  }
  try {
    const body = req.body || {};
    const first = String(body.firstName || "").trim();
    const last = String(body.lastName || "").trim();
    if (!first || !last) {
      return sendJson(res, 400, { error: "invalid_name", message: "Bitte Vor- und Nachnamen eingeben." });
    }
    const fullName = (first + " " + last).replace(/\s+/g, " ").trim();
    const key = normalizeKey(fullName);

    const supabase = getClient();

    const { data: existing, error: findErr } = await supabase
      .from("players")
      .select("id,name,name_key")
      .eq("name_key", key)
      .maybeSingle();
    if (findErr) throw findErr;

    let player;
    if (existing) {
      player = existing;
    } else {
      const { data: created, error: insErr } = await supabase
        .from("players")
        .insert({ name: fullName })
        .select("id,name")
        .single();
      if (insErr) {
        // race with another concurrent registration of the same name
        if (insErr.code === "23505") {
          const { data: retry, error: retryErr } = await supabase
            .from("players")
            .select("id,name")
            .eq("name_key", key)
            .maybeSingle();
          if (retryErr) throw retryErr;
          player = retry;
        } else {
          throw insErr;
        }
      } else {
        player = created;
      }
    }

    const state = await loadPublicState();
    return sendJson(res, 200, { playerId: player.id, playerName: player.name, state });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "server_error", message: err.message });
  }
};
