import { MongoClient } from "mongodb";
import * as fs from "fs";
import * as path from "path";

function getMongoUri(): { uri: string; dbName: string } {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return { uri: "", dbName: "register_checker" };
  const env = fs.readFileSync(envPath, "utf8");
  const uriMatch = env.match(/MONGODB_URI=["']?([^"'\r\n]+)["']?/);
  const dbMatch = env.match(/MONGODB_DB_NAME=["']?([^"'\r\n]+)["']?/);
  return {
    uri: uriMatch ? uriMatch[1].trim() : "",
    dbName: dbMatch ? dbMatch[1].trim() : "register_checker",
  };
}

async function seed() {
  const { uri, dbName } = getMongoUri();
  if (!uri) {
    console.error("❌ No MONGODB_URI in .env");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const dataDir = path.resolve("data");
  const unregPath = path.join(dataDir, "unregistered-numbers.json");

  if (!fs.existsSync(unregPath)) {
    console.error("❌ data/unregistered-numbers.json not found");
    process.exit(1);
  }

  const numbers = JSON.parse(fs.readFileSync(unregPath, "utf8"));
  console.log(`📥 Seeding ${numbers.length} unregistered numbers...`);

  const collection = db.collection("wa_check_numbers");
  for (const n of numbers) {
    await collection.updateOne(
      { phone: n.phone },
      { $set: { ...n, updated_at: new Date() } },
      { upsert: true }
    );
  }

  console.log("✅ Unregistered numbers successfully seeded into database!");
  await client.close();
}

seed().catch((err) => {
  console.error("Seeding error:", err);
  process.exit(1);
});
