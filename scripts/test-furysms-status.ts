import * as fs from "fs";

function getEnvKey(): string {
  const env = fs.readFileSync(".env", "utf8");
  const match = env.match(/FURYSMS_API_KEY=["']?([^"'\r\n]+)["']?/);
  return match ? match[1].trim() : "";
}

async function main() {
  const key = getEnvKey();
  const testId = "aftRtLBYcsQcGa8I"; // provider_id from one of the found numbers in MongoDB
  const url = `https://furysms.shop/stubs/handler_api.php?api_key=${encodeURIComponent(key)}&action=getStatus&id=${encodeURIComponent(testId)}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    console.log(`getStatus for ${testId}:`, text);
  } catch (err) {
    console.error("Error:", err);
  }
}

main();

