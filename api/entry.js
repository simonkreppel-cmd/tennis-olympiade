const { getClient } = require("./_lib/supabase");
const { loadPublicState, sendJson } = require("./_lib/state");

async function upsertOne(supabase, gameId, playerId, rawValue) {
  if (rawValue === "" || rawValue === null || rawValue === undefined) {
    const { error } = await supabase.from("entries").delete().eq("game_id", gameId).eq("player_id", playerId);
    if (error) throw error;
    return;
  }
  const value = Number(rawValue);
  if (Number.isNaN(value)) {
    var err = new Error("Wert ist keine Zahl.");
    err.invalidValue = true;
    throw err;
  }
  const { error } = await supabase
    .from("entries")
    .upsert({ game_id: gameId, player_id: playerId, value, updated_at: new Date().toISOString() }, { onConflict: "game_id,player_id" });
  if (error) throw error;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "method_not_allowed" });
  }
  try {
    const body = req.body || {};
    const gameId = String(body.gameId || "");
    if (!gameId) {
      return sendJson(res, 400, { error: "invalid_request", message: "gameId ist erforderlich." });
    }
    const supabase = getClient();

    if (body.entries && typeof body.entries === "object") {
      // bulk save: { gameId, entries: { playerId: value|null, ... } }
      const playerIds = Object.keys(body.entries);
      for (const playerId of playerIds) {
        await upsertOne(supabase, gameId, playerId, body.entries[playerId]);
      }
    } else {
      // single save: { gameId, playerId, value }
      const playerId = String(body.playerId || "");
      if (!playerId) {
        return sendJson(res, 400, { error: "invalid_request", message: "playerId ist erforderlich." });
      }
      await upsertOne(supabase, gameId, playerId, body.value);
    }

    const state = await loadPublicState();
    return sendJson(res, 200, { ok: true, state });
  } catch (err) {
    console.error(err);
    if (err.invalidValue) return sendJson(res, 400, { error: "invalid_value", message: err.message });
    return sendJson(res, 500, { error: "server_error", message: err.message });
  }
};
