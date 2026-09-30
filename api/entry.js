const { getClient } = require("./_lib/supabase");
const { loadPublicState, checkAdminCode, sendJson } = require("./_lib/state");

// Saves one result: { gameId, playerId, value } where value is a number,
// "foul" (only for games that allow it) or empty/null to clear it.
// Values outside the game's range are rejected; closed games only accept
// changes that come with a valid admin code.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "method_not_allowed" });
  }
  try {
    const body = req.body || {};
    const gameId = String(body.gameId || "");
    const playerId = String(body.playerId || "");
    if (!gameId || !playerId) {
      return sendJson(res, 400, { error: "invalid_request", message: "gameId und playerId sind erforderlich." });
    }
    const supabase = getClient();

    const { data: game, error: gameErr } = await supabase
      .from("games")
      .select("id,min_value,max_value,allow_foul,locked")
      .eq("id", gameId)
      .maybeSingle();
    if (gameErr) throw gameErr;
    if (!game) return sendJson(res, 404, { error: "unknown_game", message: "Dieses Spiel gibt es nicht mehr." });

    if (game.locked) {
      const isAdmin = await checkAdminCode(body.code);
      if (!isAdmin) {
        return sendJson(res, 403, { error: "locked", message: "Dieses Spiel ist abgeschlossen. Änderungen nur noch über den Admin." });
      }
    }

    const raw = body.value;
    if (raw === "" || raw === null || raw === undefined) {
      const { error } = await supabase.from("entries").delete().eq("game_id", gameId).eq("player_id", playerId);
      if (error) throw error;
    } else {
      let row;
      if (raw === "foul") {
        if (!game.allow_foul) return sendJson(res, 400, { error: "invalid_value", message: "Bei diesem Spiel gibt es kein Foul." });
        row = { game_id: gameId, player_id: playerId, value: 0, is_foul: true };
      } else {
        const value = Number(String(raw).replace(",", "."));
        const min = Number(game.min_value), max = Number(game.max_value);
        if (!Number.isFinite(value) || value < min || value > max) {
          return sendJson(res, 400, { error: "invalid_value", message: "Bitte eine Zahl von " + min + " bis " + max + " eintragen." });
        }
        row = { game_id: gameId, player_id: playerId, value, is_foul: false };
      }
      row.updated_at = new Date().toISOString();
      const { error } = await supabase.from("entries").upsert(row, { onConflict: "game_id,player_id" });
      if (error) throw error;
    }

    const state = await loadPublicState();
    return sendJson(res, 200, { ok: true, state });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "server_error", message: err.message });
  }
};
