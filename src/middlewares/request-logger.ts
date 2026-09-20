// requestLogger.ts
import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";
import { v4 as uuidv4 } from "uuid";

// Extend the Express Request interface to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// ponytail: one line per request; headers/bodies are never logged —
// stringifying large payloads blocked the event loop for every request.
// The gateway hands back ?encrp=<bearer reference to the transaction>, and carries the
// access token as ?_v=. Neither may reach a log file - payment.controller logs presence only,
// and this is the other place the raw URL would have given them away.
export const redactUrl = (url: string): string =>
  url.replace(/([?&](?:encrp|_v)=)[^&]*/gi, "$1<redacted>");

const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  req.requestId = uuidv4();

  res.on("finish", () => {
    logger.info(
      JSON.stringify({
        requestId: req.requestId,
        method: req.method,
        url: redactUrl(req.originalUrl),
        status: res.statusCode,
        duration: `${Date.now() - start}ms`,
      }),
    );
  });

  next();
};

export default requestLogger;
