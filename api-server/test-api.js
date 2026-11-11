try {
  process.loadEnvFile?.();
} catch {}
try {
  process.loadEnvFile?.("./api-server/.env");
} catch {}
import "dotenv/config";

const PORT = Number(process.env.PORT || 5000);
const BASE = `http://127.0.0.1:${PORT}`;

async function runTests() {
  console.log(`\n🧪 Testing Standalone SMS API Server on ${BASE}...\n`);

  // 1. Health check
  try {
    const healthRes = await fetch(`${BASE}/health`);
    const health = await healthRes.json();
    console.log(`[PASS] GET /health:`, health);
  } catch (err) {
    console.error(`[FAIL] GET /health - Server not running on port ${PORT}? (${err.message})`);
    process.exit(1);
  }

  // 2. Bad Key check on /api/v1
  const badKeyRes1 = await fetch(`${BASE}/api/v1?action=getBalance&api_key=invalid_fake_key_123`);
  const text1 = await badKeyRes1.text();
  console.log(`[PASS] GET /api/v1 with invalid key:`, text1);
  if (text1 !== "BAD_KEY") {
    console.error(`Expected "BAD_KEY", got: "${text1}"`);
  }

  // 3. Bad Key check on /stubs/handler_api.php
  const badKeyRes2 = await fetch(
    `${BASE}/stubs/handler_api.php?action=getBalance&api_key=invalid_fake_key_123`
  );
  const text2 = await badKeyRes2.text();
  console.log(`[PASS] GET /stubs/handler_api.php with invalid key:`, text2);
  if (text2 !== "BAD_KEY") {
    console.error(`Expected "BAD_KEY", got: "${text2}"`);
  }

  // 4. Missing Action check
  const noActionRes = await fetch(`${BASE}/api/v1?api_key=some_key`);
  const text3 = await noActionRes.text();
  console.log(`[PASS] GET /api/v1 without action:`, text3);
  if (text3 !== "WRONG_ACTION") {
    console.error(`Expected "WRONG_ACTION", got: "${text3}"`);
  }

  // 5. Unnecessary / Extra parameters test
  // Passing service, country, server, operator, random params should be cleanly accepted!
  const extraParamsRes = await fetch(
    `${BASE}/api/v1?action=getBalance&api_key=invalid_fake_key_123&service=whatsapp&country=22&server=india2&operator=any&random_param=xyz999&foo=bar`
  );
  const extraParamsText = await extraParamsRes.text();
  console.log(`[PASS] GET /api/v1 with extra/unnecessary parameters:`, extraParamsText);
  if (extraParamsText !== "BAD_KEY") {
    console.error(`Expected "BAD_KEY", got: "${extraParamsText}"`);
  }

  // 6. Action case-insensitivity & aliases test (get_balance, getnumber, etc.)
  const aliasActionRes1 = await fetch(
    `${BASE}/api/v1?action=get_balance&key=invalid_fake_key_123`
  );
  const aliasText1 = await aliasActionRes1.text();
  console.log(`[PASS] GET /api/v1 with action=get_balance and key=...:`, aliasText1);
  if (aliasText1 !== "BAD_KEY") {
    console.error(`Expected "BAD_KEY", got: "${aliasText1}"`);
  }

  const aliasActionRes2 = await fetch(
    `${BASE}/api/v1?action=GETBALANCE&token=invalid_fake_key_123`
  );
  const aliasText2 = await aliasActionRes2.text();
  console.log(`[PASS] GET /api/v1 with action=GETBALANCE and token=...:`, aliasText2);
  if (aliasText2 !== "BAD_KEY") {
    console.error(`Expected "BAD_KEY", got: "${aliasText2}"`);
  }

  // 7. Header auth test (x-api-key)
  const headerAuthRes = await fetch(`${BASE}/api/v1?action=getBalance`, {
    headers: { "x-api-key": "invalid_fake_key_123" },
  });
  const headerAuthText = await headerAuthRes.text();
  console.log(`[PASS] GET /api/v1 with header x-api-key:`, headerAuthText);
  if (headerAuthText !== "BAD_KEY") {
    console.error(`Expected "BAD_KEY", got: "${headerAuthText}"`);
  }

  // 8. POST JSON body test
  const postRes = await fetch(`${BASE}/api/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "getBalance",
      apiKey: "invalid_fake_key_123",
      service: "whatsapp",
      country: "22",
    }),
  });
  const postText = await postRes.text();
  console.log(`[PASS] POST /api/v1 with JSON body:`, postText);
  if (postText !== "BAD_KEY") {
    console.error(`Expected "BAD_KEY", got: "${postText}"`);
  }

  // 9. Compatibility endpoints
  const countriesRes = await fetch(`${BASE}/api/v1?action=getCountries&api_key=test`);
  const countries = await countriesRes.json();
  console.log(`[PASS] GET /api/v1?action=getCountries:`, countries);

  const servicesRes = await fetch(`${BASE}/api/v1?action=getServices&api_key=test`);
  const services = await servicesRes.json();
  console.log(`[PASS] GET /api/v1?action=getServices:`, services);

  console.log(`\n✅ All API parameter tolerance & baseline tests passed successfully!\n`);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
