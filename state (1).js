const { loadPublicState, sendJson } = require("./_lib/state");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "method_not_allowed" });
  }
  try {
    const state = await loadPublicState();
    return sendJson(res, 200, state);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "server_error", message: err.message });
  }
};
