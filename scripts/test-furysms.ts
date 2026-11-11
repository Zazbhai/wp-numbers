import * as fs from "fs";

function getEnvKey(): string {
  const env = fs.readFileSync(".env", "utf8");
  const match = env.match(/FURYSMS_API_KEY=["']?([^"'\r\n]+)["']?/);
  return match ? match[1].trim() : "";
}

async function main() {
  const key = getEnvKey();
  console.log("Testing FurySMS API with key:", key.slice(0, 6) + "...");
  const balanceUrl = `https://furysms.shop/stubs/handler_api.php?api_key=${encodeURIComponent(key)}&action=getBalance`;
  try {
    const res = await fetch(balanceUrl);
    const text = await res.text();
    console.log("Balance:", text);
  } catch (err) {
    console.error("Error fetching balance:", err);
  }
}

main();

