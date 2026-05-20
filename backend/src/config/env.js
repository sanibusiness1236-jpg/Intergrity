const dotenv = require("dotenv");
dotenv.config();

const rawCorsOrigin = process.env.CORS_ORIGIN;

function parseCorsOrigin(value) {
  if (!value || value === "*") return "*";
  const list = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 1 ? list[0] : list;
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  corsOrigin: parseCorsOrigin(rawCorsOrigin),
  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "dev-refresh-secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },
  mlServiceUrl: process.env.ML_SERVICE_URL || "http://localhost:8000",
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    logoBucket: process.env.SUPABASE_LOGO_BUCKET || "institution-logos",
  },
};
