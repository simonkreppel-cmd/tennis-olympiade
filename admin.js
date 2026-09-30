const { getClient } = require("./_lib/supabase");
const { loadPublicState, checkAdminCode, sendJson } = require("./_lib/state");

// All admin writes go through SECURITY DEFINER Postgres functions that check
// the admin code themselves (see supabase_schema.sql).
function rpcError(res, error) {
  const msg = (error && error.message) || "";
  if (msg.indexOf("wrong_code") !== -1) return sendJson(res, 401, { error: "wrong_code", message: "Admin-Code stimmt nicht (mehr)." });
  if (msg.indexOf("duplicate_name") !== -1) return sendJson(res, 409, { error: "duplicate_name", message: "Diesen Namen gibt es schon." });
  throw error;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "method_not_allowed" });
  }
  try {
    const body = req.body || {};
    const action = body.action;
    const code = String(body.code || "");
    const supabase = getClient();

    if (action === "login") {
      const ok = await checkAdminCode(code);
      if (!ok) return sendJson(res, 401, { error: "wrong_code", message: "Code ist leider falsch." });
      return sendJson(res, 200, { ok: true });
    }

    if (action === "save-event") {
      const { error } = await supabase.rpc("admin_save_setup", {
        input_code: code,
        new_event_title: typeof body.eventTitle === "string" ? body.eventTitle : null,
        new_event_sub: typeof body.eventSub === "string" ? body.eventSub : null,
        new_event_date: typeof body.eventDate === "string" ? body.eventDate : null,
        new_admin_code: typeof body.adminCode === "string" && body.adminCode.trim() ? body.adminCode.trim() : null,
        new_players: null,
        new_games: null,
      });
      if (error) return rpcError(res, error);
    } else if (action === "game") {
      const { error } = await supabase.rpc("admin_set_game", {
        input_code: code,
        game_id: String(body.gameId || ""),
        new_locked: typeof body.locked === "boolean" ? body.locked : null,
        new_rules: typeof body.rules === "string" ? body.rules : null,
        new_hint: typeof body.hint === "string" ? body.hint : null,
      });
      if (error) return rpcError(res, error);
    } else if (action === "player") {
      const { error } = await supabase.rpc("admin_player", {
        input_code: code,
        player_id: String(body.playerId || ""),
        new_name: typeof body.name === "string" ? body.name : null,
        remove: body.remove === true,
      });
      if (error) return rpcError(res, error);
    } else {
      return sendJson(res, 400, { error: "unknown_action" });
    }

    const state = await loadPublicState();
    return sendJson(res, 200, { ok: true, state });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "server_error", message: err.message });
  }
};
