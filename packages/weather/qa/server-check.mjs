// Weather server check: the module's parsing, input checks, caching and rate limit
// against recorded real answers from Open-Meteo (forecast, place search) and
// OpenStreetMap Nominatim (place name). No network, database or stack needed.
//   pnpm build && pnpm server:validate
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientAddress, createHomiServerModule, isPublicAddress, normalizeApproximate, normalizeForecast } from '../dist/server.js';
const dir = new URL('./fixtures/', import.meta.url).pathname;
const f = normalizeForecast(JSON.parse(readFileSync(dir + 'forecast.json', 'utf8')), new Date());
assert.equal(f.timezone, 'America/Toronto'); assert.equal(f.hourly.length, 12); assert.equal(f.daily.length, 5);
console.log('forecast ok:', f.timezone, '| now', f.current.tempC + '°C code', f.current.code, f.current.isDay ? 'day' : 'night', '| hourly', f.hourly.length, 'first', f.hourly[0]?.time, '| daily', f.daily.length, f.daily[0]);
// Recorded real answers from the three services; the module is exercised with a replay fetcher.
const bodies = { 'geocoding-api.open-meteo.com': readFileSync(dir + 'search.json', 'utf8'), 'nominatim.openstreetmap.org': readFileSync(dir + 'reverse.json', 'utf8'), 'api.open-meteo.com': readFileSync(dir + 'forecast.json', 'utf8'), 'ipwho.is': readFileSync(dir + 'ipwho.json', 'utf8'), 'get.geojs.io': readFileSync(dir + 'geojs.json', 'utf8') };
const districtReverse = readFileSync(dir + 'reverse-scarborough.json', 'utf8');
const calls = [];
const fetcher = async (url, init) => { calls.push(url.hostname + ' ' + url.search.slice(0, 60)); return { ok: true, status: 200, text: async () => bodies[url.hostname] }; };
const routes = {};
const app = { get: (path, fn) => { routes[path] = fn; } };
const host = { moduleDatabase: {}, resolveContext: async () => ({ userId: 'u1', householdId: 'h1' }), requireEnabled: async () => {} };
const mod = createHomiServerModule(host, { fetcher });
mod.register(app);
const req = (query) => ({ id: 'r', headers: {}, query, params: {} });
const search = await routes['/api/v1/modules/weather/search'](req({ q: 'Winnipeg' }));
assert.equal(search.data.length, 8); assert.equal(search.data[0].name, 'Winnipeg'); assert.equal(search.data[0].region, 'Manitoba');
console.log('search ok:', search.data.length, 'results, first:', JSON.stringify(search.data[0]));
const name = await routes['/api/v1/modules/weather/place-name'](req({ lat: '45.4215', lon: '-75.6972' }));
assert.equal(name.data.name, 'Ottawa'); assert.equal(name.data.region, 'Ontario');
console.log('place-name ok:', JSON.stringify(name.data));
const fc = await routes['/api/v1/modules/weather/forecast'](req({ lat: '45.4215', lon: '-75.6972' }));
await routes['/api/v1/modules/weather/forecast'](req({ lat: '45.4249', lon: '-75.6921' }));
console.log('forecast route ok, calls made (second request served from cache):', calls.filter(c => c.startsWith('api.open-meteo')).length);
assert.match(calls.find((c) => c.startsWith('api.open-meteo')) ?? '', /latitude=45\.42&longitude=-75\.7&/, 'coordinates are rounded to two decimals before leaving Homi');
console.log('coordinates sent upstream:', calls.filter(c => c.startsWith('api.open-meteo'))[0]);
for (const bad of [{ lat: '999', lon: '0' }, { lat: 'abc', lon: '0' }, {}]) { try { await routes['/api/v1/modules/weather/forecast'](req(bad)); assert.fail('bad coordinates were not rejected: ' + JSON.stringify(bad)); } catch (e) { console.log('rejected', JSON.stringify(bad), '->', e.statusCode, e.code); } }
try { await routes['/api/v1/modules/weather/search'](req({ q: 'a' })); } catch (e) { console.log('short search rejected ->', e.statusCode); }
let limited = 0; for (let i = 0; i < 70; i++) { try { await routes['/api/v1/modules/weather/forecast'](req({ lat: '10', lon: '10' })); } catch (e) { if (e.statusCode === 429) limited++; } } assert.ok(limited > 0, 'the rate limit never applied'); console.log('rate limit kicked in for', limited, 'of 70 rapid requests');

// ---- Approximate location, for a device that cannot give a precise one ----
for (const address of ['8.8.8.8', '203.0.113.7', '2001:4860:4860::8888']) assert.equal(isPublicAddress(address), true, address + ' is a public address');
for (const address of ['10.0.0.5', '192.168.0.10', '172.20.0.1', '127.0.0.1', '169.254.1.1', '100.64.0.9', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.5', 'not-an-ip', '']) assert.equal(isPublicAddress(address), false, address + ' is not a public address');
assert.equal(clientAddress({ headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '8.8.8.8' } }), '203.0.113.7', 'the Cloudflare address wins');
assert.equal(clientAddress({ headers: { 'x-forwarded-for': '8.8.4.4, 10.0.0.1' } }), '8.8.4.4', 'the visitor is the first address; the proxies after it are ignored');
assert.equal(clientAddress({ headers: { 'x-forwarded-for': '192.168.1.5, 8.8.4.4' } }), null, 'a visitor on the home network has no place on a map (8.8.4.4 here is only a proxy)');
assert.equal(clientAddress({ headers: { 'x-forwarded-for': '192.168.1.5' }, ip: '172.20.0.1' }), null, 'only private addresses give no address');
const ottawa = normalizeApproximate(JSON.parse(readFileSync(dir + 'ipwho.json', 'utf8')), 'ipwho.is');
assert.deepEqual(ottawa, { name: 'Ottawa', region: 'Ontario', country: 'Canada', latitude: 45.41, longitude: -75.7 });
assert.equal(normalizeApproximate({ success: false, message: 'Reserved range' }, 'ipwho.is'), null, 'a failed lookup gives nothing');
assert.equal(normalizeApproximate({ success: true, latitude: 999, longitude: 0, city: 'X' }, 'ipwho.is'), null, 'out-of-range coordinates are refused');
assert.equal(normalizeApproximate(JSON.parse(readFileSync(dir + 'geojs.json', 'utf8')), 'geojs')?.name, 'Scarborough', 'the second service parses too');
{
  const seen = [];
  const answer = (map) => async (url) => { seen.push(url.hostname + url.pathname); const body = map[url.hostname]; return body === undefined ? { ok: false, status: 503, text: async () => '' } : { ok: true, status: 200, text: async () => body }; };
  const make = (map) => { const r = {}; createHomiServerModule(host, { fetcher: answer(map) }).register({ get: (path, fn) => { r[path] = fn; } }); return r; };
  const locate = (r, headers, ip) => r['/api/v1/modules/weather/locate']({ id: 'r', headers, query: {}, params: {}, ip });
  let routes = make(bodies);
  let got = await locate(routes, { 'cf-connecting-ip': '203.0.113.7' });
  assert.equal(got.data.name, 'Scarborough', 'the main service (geojs.io) answers first');
  assert.equal(got.data.approximate, true);
  assert.ok(seen.includes('get.geojs.io/v1/ip/geo/203.0.113.7.json'), 'the member\'s own address is asked about');
  seen.length = 0; routes = make(bodies);
  await locate(routes, { 'x-forwarded-for': '192.168.1.5' }, '172.20.0.1');
  assert.ok(seen.includes('get.geojs.io/v1/ip/geo.json'), 'a private address asks about the household\'s own connection instead');
  seen.length = 0; routes = make({ 'ipwho.is': bodies['ipwho.is'] });
  got = await locate(routes, { 'cf-connecting-ip': '203.0.113.7' });
  assert.equal(got.data.name, 'Ottawa'); assert.ok(seen.some((c) => c.startsWith('ipwho.is')), 'the backup service (ipwho.is) answers when the first is down');
  routes = make({});
  await assert.rejects(() => locate(routes, { 'cf-connecting-ip': '203.0.113.7' }), (e) => e.statusCode === 502 && e.code === 'WEATHER_LOCATE_FAILED');
  // A position inside an amalgamated city is named for its community, not the whole city,
  // which is where a forecast link for the same coordinates goes.
  routes = make({ 'nominatim.openstreetmap.org': districtReverse });
  const community = await routes['/api/v1/modules/weather/place-name']({ id: 'r', headers: {}, query: { lat: '43.77', lon: '-79.23' }, params: {} });
  assert.deepEqual({ name: community.data.name, region: community.data.region, country: community.data.country }, { name: 'Scarborough', region: 'Toronto', country: 'Canada' });
  console.log('locate ok: Scarborough from the main service, Ottawa from the backup, 502 when both are down, private addresses handled; a position in a Toronto district is named Scarborough, Toronto');
}
console.log('PASS_HOMI_WEATHER_SERVER_CHECK');
