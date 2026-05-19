// Notifies Yandex (and other IndexNow participants) about updated URLs.
// Run manually after a production deploy:
//   node scripts/ping-indexnow.mjs
// Docs: https://yandex.com/support/webmaster/indexnow/key.html

const HOST = "sokratai.ru";
const KEY = "3bee14281b9863f17648f815d721fc12";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

const urlList = [
  `https://${HOST}/`,
  `https://${HOST}/students`,
  `https://${HOST}/register-tutor`,
  `https://${HOST}/signup`,
  `https://${HOST}/login`,
  `https://${HOST}/tutor/login`,
  `https://${HOST}/offer`,
  `https://${HOST}/privacy-policy`,
  `https://${HOST}/requisites`,
];

const endpoints = [
  "https://yandex.com/indexnow",
  "https://api.indexnow.org/indexnow",
];

const body = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: KEY_LOCATION,
  urlList,
});

for (const endpoint of endpoints) {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body,
    });
    console.log(`[indexnow] ${endpoint} → ${res.status} ${res.statusText}`);
  } catch (err) {
    console.error(`[indexnow] ${endpoint} failed:`, err);
  }
}