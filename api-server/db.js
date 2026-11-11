import { MongoClient } from "mongodb";

const uri =
  process.env.MONGODB_URI ||
  "mongodb+srv://zgarmyofficial_db_user:UKcgptaIfvU5GWeL@cluster0.7a33rwb.mongodb.net/";
const dbName = process.env.MONGODB_DB_NAME || "register_checker";

let client = null;
let db = null;
let connectingPromise = null;

export async function getDb() {
  if (db) return db;

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    try {
      client = new MongoClient(uri, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 10000,
      });

      await client.connect();
      db = client.db(dbName);
      console.log(`[Database] Successfully connected to MongoDB database: "${dbName}"`);
      return db;
    } catch (err) {
      connectingPromise = null;
      db = null;
      console.error("[Database] MongoDB connection failed:", err.message);
      throw err;
    }
  })();

  return connectingPromise;
}

export async function closeDb() {
  if (client) {
    try {
      await client.close();
      console.log("[Database] MongoDB connection closed cleanly.");
    } catch (err) {
      console.error("[Database] Error closing MongoDB:", err);
    } finally {
      client = null;
      db = null;
      connectingPromise = null;
    }
  }
}

