import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import registerRoutes from "./routes/routes";
import connectToMongoDB from "./utils/mongo-connection";
import config from "./config/default";
import errorHandler from "./middlewares/error-handler";
import requestLogger from "./middlewares/request-logger";
import path from "path";
import fs from "fs";
import authMiddleware from "./middlewares/auth";
import seedMetadata from "./seeders/metadata.seeder";
import seedSubscriptionPlan from "./seeders/subscription-plan.seeder";
import seedSuperAdmin from "./seeders/super-admin.seeder";
import { setupAgendaJobs } from "./scheduler/agenda";

const app = express();

// Trust proxy setup for getting actual user IP behind a reverse proxy (like Nginx or Heroku)
// This is important for rate limiting and logging the correct IP address
// Two hops: Next.js server's Nginx, then the backend's own Nginx, both prepend to X-Forwarded-For
app.set("trust proxy", 2);

// Middleware setup
// Media goes through multer/presigned multipart uploads, never JSON bodies.
app.use(express.json({ limit: "1mb" }));
app.use(compression()); // Compress response bodies for all requests
app.use(helmet()); // Security headers
app.use(express.urlencoded({ extended: true, limit: "1mb" })); // Parse URL-encoded bodies
app.use(requestLogger);

// Ensure uploads directories exist
const publicUploadsDir = path.join(__dirname, "../uploads/public");
const privateUploadsDir = path.join(__dirname, "../uploads/private");

if (!fs.existsSync(publicUploadsDir)) {
  fs.mkdirSync(publicUploadsDir, { recursive: true });
}
if (!fs.existsSync(privateUploadsDir)) {
  fs.mkdirSync(privateUploadsDir, { recursive: true });
}

// Serve static files from public uploads directory
app.use("/uploads/public", express.static(publicUploadsDir));

// Serve static files from private uploads directory with authentication
app.use("/uploads/private", authMiddleware, express.static(privateUploadsDir));

// CORS configuration
const corsOptions = {
  origin: config.clientUrl, // Replace with the domain you want to allow
  methods: "GET,POST,PUT,DELETE,PATCH",
  allowedHeaders: "Content-Type,Authorization", // Specify allowed headers
  credentials: true, // Allow cookies to be sent across origins
};

// Use CORS middleware
app.use(cors(corsOptions));

if (config.environment === "production") {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later.",
  });

  app.use(limiter);
}
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({ message: "Hello Server" });
});

app.get("/welcome", (req: Request, res: Response) => {
  res
    .status(200)
    .json({ status: "success", message: "Welcome to the Sniper API" });
});
// MongoDB Connection
connectToMongoDB(config.db.uri).then(() => {
  seedMetadata();
  seedSubscriptionPlan();
  seedSuperAdmin();
  setupAgendaJobs();
});

// Routes
registerRoutes(app);

// Error-handling middleware
app.use(errorHandler);

export default app;
