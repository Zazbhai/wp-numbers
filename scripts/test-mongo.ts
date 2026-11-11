import { MongoClient, ServerApiVersion } from "mongodb";
import * as fs from "fs";
import * as path from "path";

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main() {
  loadEnv();

  console.log("==========================================");
  console.log("       MongoDB Connection Checker         ");
  console.log("==========================================\n");

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  const dbName = process.env.MONGODB_DB_NAME || "register_checker";

  if (!uri) {
    console.error("❌ MONGODB_URI is not set in .env!");
    console.log("\nPlease add your MongoDB connection string in .env like:");
    console.log('MONGODB_URI="mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/register_checker?retryWrites=true&w=majority"');
    console.log("or for local MongoDB:");
    console.log('MONGODB_URI="mongodb://localhost:27017/register_checker"');
    process.exit(1);
  }

  // Mask credentials for display
  const maskedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@");
  console.log(`Connecting to: ${maskedUri}`);
  console.log(`Target Database: ${dbName}`);

  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: false,
      deprecationErrors: true,
    },
    serverSelectionTimeoutMS: 6000,
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const pingResult = await db.command({ ping: 1 });
    console.log("\n✅ MongoDB connection test SUCCESSFUL!");
    console.log("Ping response:", pingResult);

    const collections = await db.listCollections().toArray();
    console.log(`Existing collections (${collections.length}):`, collections.map((c) => c.name).join(", ") || "(none yet)");

    await client.close();
    process.exit(0);
  } catch (err: any) {
    console.error("\n❌ MongoDB connection test FAILED!");
    console.error("Error details:", err?.message || err);
    process.exit(1);
  }
}

main();

