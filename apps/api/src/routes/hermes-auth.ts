import type express from "express";
import { normalizeText } from "../workflow-v2/types.js";
import { sendError } from "./utils.js";

function resolveRequestApiKey(req: express.Request) {
  const header = req.headers["x-hermes-api-key"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const bearer = auth.match(/^Bearer\s+(.+)$/i);
    if (bearer?.[1]) {
      return bearer[1].trim();
    }
  }
  return "";
}

export function validateHermesApiKey(req: express.Request, res: express.Response) {
  const expected = normalizeText(process.env.HERMES_API_KEY);
  if (!expected) {
    return true;
  }

  const actual = resolveRequestApiKey(req);
  if (actual && actual === expected) {
    return true;
  }

  sendError(res, 401, "UNAUTHORIZED", "invalid hermes api key");
  return false;
}
