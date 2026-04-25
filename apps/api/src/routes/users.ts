import express from "express";
import { parseSessionToken, getCurrentUser } from "../security/auth.js";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";

export function createUsersRouter() {
  const router = express.Router();

  router.get("/me", asyncRoute(async (req, res) => {
    const sessionToken = parseSessionToken(req.headers.cookie);
    const user = await getCurrentUser(sessionToken);
    if (!user) {
      sendError(res, 401, "UNAUTHORIZED", "authentication required");
      return;
    }

    sendSuccess(res, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    });
  }));

  return router;
}
