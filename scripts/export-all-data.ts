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

async function exportData() {
  const { uri, dbName } = getMongoUri();
  if (!uri) {
    console.error("No MONGODB_URI found in .env");
    return;
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const dataDir = path.resolve("data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 1. Export unregistered / available numbers
  const availableNumbers = await db
    .collection("wa_check_numbers")
    .find({ status: { $in: ["available", "found", "sent"] } }, { projection: { _id: 0 } })
    .sort({ created_at: -1 })
    .toArray();

  fs.writeFileSync(
    path.join(dataDir, "unregistered-numbers.json"),
    JSON.stringify(availableNumbers, null, 2),
    "utf8"
  );
  console.log(`✅ Exported ${availableNumbers.length} unregistered numbers to data/unregistered-numbers.json`);

  // Plain text list of just the phone numbers
  const phoneList = availableNumbers.map((n: any) => n.phone).join("\n");
  fs.writeFileSync(path.join(dataDir, "unregistered-numbers.txt"), phoneList, "utf8");
  console.log(`✅ Exported phone list to data/unregistered-numbers.txt`);

  // 2. Export all numbers inventory summary
  const allNumbers = await db
    .collection("wa_check_numbers")
    .find({}, { projection: { _id: 0 } })
    .toArray();

  fs.writeFileSync(
    path.join(dataDir, "all-numbers-backup.json"),
    JSON.stringify(allNumbers, null, 2),
    "utf8"
  );
  console.log(`✅ Exported all ${allNumbers.length} numbers backup to data/all-numbers-backup.json`);

  // 3. Export settings / business lines
  const businessLines = await db.collection("business_lines").find({}, { projection: { _id: 0 } }).toArray();
  fs.writeFileSync(
    path.join(dataDir, "business-lines-config.json"),
    JSON.stringify(businessLines, null, 2),
    "utf8"
  );
  console.log(`✅ Exported business lines config to data/business-lines-config.json`);

  // 4. Create seed import script info
  console.log("\n📦 Data export complete!");
  await client.close();
}

exportData().catch((err) => {
  console.error("Export error:", err);
  process.exit(1);
});

