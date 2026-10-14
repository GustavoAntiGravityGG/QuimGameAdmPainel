const { timingSafeEqual } = require('node:crypto');
const SEED = require('../data/recipes.json');

const CATALOG_KEY = 'quim-game:recipes:v1';
const DEFAULT_ORIGINS = [
  'https://quim-game-adm.vercel.app',
  'https://quim-game.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

function allowedOrigins(req) {
  const configured = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const origins = new Set([...DEFAULT_ORIGINS, ...configured]);
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (origin && host && origin === `${protocol}://${host}`) origins.add(origin);
  return { origins, origin };
}

function send(req, res, status, payload) {
  const { origins, origin } = allowedOrigins(req);
  res.setHeader('Vary', 'Origin');
  if (origin && origins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(payload);
}

function authorized(req) {
  const expected = process.env.ADMIN_API_TOKEN || '';
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redisCommand(commands) {
  const config = redisConfig();
  if (!config) throw new Error('Redis não configurado.');
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result) || result.some(item => item && item.error)) {
    throw new Error('Falha ao acessar o armazenamento Redis.');
  }
  return result.map(item => item.result);
}

function readRequestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  return {};
}

function inferClassKey(item) {
  const name = String(item.name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();
  if (/^Acido\b/i.test(name)) return 'acido';
  const category = String(item.category || item.cat || '').toLowerCase();
  if (category === 'acidos') return 'acido';
  if (category === 'ligas' || /[-–—]/.test(String(item.formula || '')) || /^nº\s*\d+/i.test(String(item.formula || ''))) return 'metais';
  return 'outros';
}

function normalizeRecipeGroups(value) {
  let sourceGroups;
  if (Array.isArray(value)) {
    sourceGroups = Object.create(null);
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Há uma receita inválida no catálogo.');
      const classKey = String(item.classKey || item.class || inferClassKey(item)).trim().toLowerCase();
      if (!/^[a-z0-9_-]{1,60}$/.test(classKey)) throw new Error('Nome de classe inválido. Use letras sem acento, números, hífen ou sublinhado.');
      if (!Object.hasOwn(sourceGroups, classKey)) sourceGroups[classKey] = [];
      sourceGroups[classKey].push(item);
    }
  } else {
    sourceGroups = value?.class && typeof value.class === 'object' && !Array.isArray(value.class) ? value.class : null;
    if (!sourceGroups) throw new Error('Envie receitas agrupadas em recipes.class.');
  }

  const groups = Object.create(null);
  const uids = new Set();
  const pairs = new Set();
  let count = 0;
  for (const [rawClassKey, items] of Object.entries(sourceGroups)) {
    const classKey = String(rawClassKey).trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,60}$/.test(classKey)) throw new Error('Nome de classe inválido. Use letras sem acento, números, hífen ou sublinhado.');
    if (!Array.isArray(items)) throw new Error(`A classe ${classKey} precisa conter uma lista de receitas.`);
    groups[classKey] = [];
    for (const item of items) {
      count += 1;
      if (count > 5000) throw new Error('Envie até 5.000 receitas.');
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Receita ${count} inválida.`);
      const recipe = {
        uid: String(item.uid || '').trim(),
        a: String(item.a || '').trim(),
        b: String(item.b || '').trim(),
        productId: String(item.productId || '').trim(),
        name: String(item.name || '').trim(),
        formula: String(item.formula || '').trim(),
        icon: String(item.icon || '🧪').trim(),
        equation: String(item.equation || '').trim()
      };
      const category = String(item.category || item.cat || '').trim();
      if (category) recipe.category = category;
      if (!recipe.uid || recipe.uid.length > 100 || uids.has(recipe.uid)) throw new Error(`Identificador repetido ou inválido na receita ${count}.`);
      if (![recipe.a, recipe.b, recipe.productId].every(id => /^[A-Za-z0-9_-]{1,60}$/.test(id))) throw new Error(`ID de reagente ou produto inválido na receita ${count}.`);
      if (!recipe.name || recipe.name.length > 120 || !recipe.formula || recipe.formula.length > 80 || recipe.icon.length > 16 || recipe.equation.length > 500 || category.length > 50) throw new Error(`Campos longos ou vazios na receita ${count}.`);
      const pair = [recipe.a, recipe.b].sort().join('+');
      if (pairs.has(pair)) throw new Error(`A combinação ${recipe.a} + ${recipe.b} aparece mais de uma vez.`);
      uids.add(recipe.uid);
      pairs.add(pair);
      groups[classKey].push(recipe);
    }
  }
  return { class: groups };
}

module.exports = async function handler(req, res) {
  const { origins, origin } = allowedOrigins(req);
  if (req.method === 'OPTIONS') {
    if (origin && !origins.has(origin)) return send(req, res, 403, { error: 'Origem não autorizada.' });
    res.status(204).end();
    return;
  }
  if (origin && !origins.has(origin)) return send(req, res, 403, { error: 'Origem não autorizada.' });

  if (req.method === 'GET') {
    try {
      const configured = !!redisConfig();
      if (!configured) return send(req, res, 200, { version: 2, updatedAt: null, recipes: normalizeRecipeGroups(SEED.recipes), source: 'seed', writable: false });
      const values = await redisCommand([['GET', CATALOG_KEY]]);
      if (!values[0]) return send(req, res, 200, { version: 2, updatedAt: null, recipes: normalizeRecipeGroups(SEED.recipes), source: 'seed', writable: true });
      const saved = JSON.parse(values[0]);
      if (!saved || !saved.recipes) throw new Error('Catálogo salvo inválido.');
      return send(req, res, 200, { version: 2, updatedAt: saved.updatedAt || null, recipes: normalizeRecipeGroups(saved.recipes), source: 'redis', writable: true });
    } catch (error) {
      return send(req, res, 503, { error: error.message || 'Não foi possível carregar o catálogo.' });
    }
  }

  if (req.method === 'POST') {
    if (!process.env.ADMIN_API_TOKEN) return send(req, res, 503, { error: 'ADMIN_API_TOKEN ainda não foi configurado no Vercel.' });
    if (!authorized(req)) return send(req, res, 401, { error: 'Token ADM inválido.' });
    return send(req, res, 200, { authenticated: true, writable: !!redisConfig() });
  }

  if (req.method === 'PUT') {
    if (!authorized(req)) return send(req, res, 401, { error: 'Token ADM inválido ou não configurado.' });
    if (!redisConfig()) return send(req, res, 503, { error: 'Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN no Vercel.' });
    try {
      const body = readRequestBody(req);
      const recipes = normalizeRecipeGroups(body.recipes);
      const count = Object.values(recipes.class).reduce((total, items) => total + items.length, 0);
      const serialized = JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), recipes });
      if (Buffer.byteLength(serialized, 'utf8') > 1_500_000) return send(req, res, 413, { error: 'O catálogo excedeu o limite de 1,5 MB.' });
      await redisCommand([['SET', CATALOG_KEY, serialized]]);
      return send(req, res, 200, { ok: true, count, updatedAt: JSON.parse(serialized).updatedAt });
    } catch (error) {
      const badRequest = error instanceof SyntaxError || /receitas agrupadas|lista de receitas|classe inválida|até 5\.000|receita inválida|repetido|ID de reagente|Campos longos|aparece mais de uma vez/i.test(error.message || '');
      return send(req, res, badRequest ? 400 : 503, { error: error.message || 'Não foi possível salvar o catálogo.' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT, OPTIONS');
  return send(req, res, 405, { error: 'Método não permitido.' });
};
