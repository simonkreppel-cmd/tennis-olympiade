const { getClient } = require("./_lib/supabase");
const { loadPublicState, checkAdminCode, sendJson } = require("./_lib/state");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "method_not_allowed" });
  }
  try {
    const body = req.body || {};
    const action = body.action;

    if (action === "login") {
      const ok = await checkAdminCode(body.code);
      if (!ok) return sendJson(res, 401, { error: "wrong_code", message: "Code ist leider falsch." });
      return sendJson(res, 200, { ok: true });
    }

    if (action === "save-setup") {
      const supabase = getClient();

      const players = Array.isArray(body.players)
        ? body.players.map((p) => ({ id: String(p.id || ""), name: String(p.name || "").trim() })).filter((p) => p.id && p.name)
        : null;
      const games = Array.isArray(body.games)
        ? body.games
            .map((g) => ({
              id: String(g.id || ""),
              name: String(g.name || "").trim() || "Spiel",
              unit: String(g.unit || ""),
              direction: g.direction === "low" ? "low" : "high",
            }))
            .filter((g) => g.id)
        : null;

      // admin_save_setup() is a SECURITY DEFINER Postgres function: it checks
      // input_code against the real admin code itself (the anon key used here
      // has no direct read/write access to config/players/games writes at all,
      // see supabase_schema.sql) and applies every change atomically.
      const { error } = await supabase.rpc("admin_save_setup", {
        input_code: String(body.code || ""),
        new_event_title: typeof body.eventTitle === "string" ? body.eventTitle : null,
        new_event_sub: typeof body.eventSub === "string" ? body.eventSub : null,
        new_event_date: typeof body.eventDate === "string" ? body.eventDate : null,
        new_admin_code: typeof body.adminCode === "string" && body.adminCode.trim() ? body.adminCode.trim() : null,
        new_players: players,
        new_games: games,
      });

      if (error) {
        if (error.message && error.message.indexOf("wrong_code") !== -1) {
          return sendJson(res, 401, { error: "wrong_code", message: "Admin-Code stimmt nicht (mehr)." });
        }
        if (error.message && error.message.indexOf("duplicate_name") !== -1) {
          return sendJson(res, 409, { error: "duplicate_name", message: "Zwei Spieler haben (fast) denselben Namen - bitte einen davon anpassen." });
        }
        throw error;
      }

      const state = await loadPublicState();
      return sendJson(res, 200, { ok: true, state });
    }

    return sendJson(res, 400, { error: "unknown_action" });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "server_error", message: err.message });
  }
};
