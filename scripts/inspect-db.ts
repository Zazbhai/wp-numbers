import { MongoClient } from "mongodb";
import * as fs from "fs";

function getMongoUri(): string {
  const env = fs.readFileSync(".env", "utf8");
  const match = env.match(/MONGODB_URI=["']?([^"'\r\n]+)["']?/);
  return match ? match[1].trim() : "";
}

async function main() {
  const uri = getMongoUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("register_checker");
  
  const counts = await db.collection("wa_check_numbers").aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } }
  ]).toArray();
  console.log("Status counts:", counts);

  const found = await db.collection("wa_check_numbers").find({
    status: { $in: ["found", "sent", "available"] }
  }).toArray();
  console.log("Unregistered / Found numbers count:", found.length);
  console.log("Sample:", found.slice(0, 10).map((f) => ({
    phone: f.phone,
    status: f.status,
    provider_id: f.provider_id,
    note: f.note
  })));

  await client.close();
}

main();

