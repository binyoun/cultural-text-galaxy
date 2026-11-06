const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Optional persistence layer. Local dev and testing stay exactly as before,
// in-memory only, when these env vars aren't set. On Render (or anywhere
// running the actual online workshop) set SUPABASE_URL and
// SUPABASE_SERVICE_KEY so entries and images survive a server restart or
// redeploy instead of living only in memory / on an ephemeral disk.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'handwriting-uploads';
const TABLE = 'entries';

let isConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
// Why Supabase was switched off at runtime, shown on /api/health. Never
// includes the key itself.
let lastError = null;

let client = null;
if (isConfigured) {
  try {
    // Node below 22 has no native WebSocket, which supabase-js requires, so
    // hand it the ws package the server already uses.
    client = createClient(SUPABASE_URL.trim(), SUPABASE_SERVICE_KEY.trim(), {
      realtime: { transport: WebSocket },
    });
  } catch (err) {
    disable(err);
  }
}

// Fall back to in-memory instead of crashing, so a bad setting on Render
// can't take the whole site down mid-workshop.
function disable(err) {
  isConfigured = false;
  client = null;
  const cause = err && err.cause ? ` (${err.cause.code || err.cause.message})` : '';
  lastError = ((err && err.message) || String(err)) + cause;
  console.error(`Supabase disabled, falling back to in-memory: ${lastError}`);
}

async function uploadImage(filename, buffer) {
  const { error } = await client.storage.from(BUCKET).upload(filename, buffer, {
    contentType: 'image/png',
    upsert: false,
  });
  if (error) throw error;

  const { data } = client.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

async function insertEntry(entry) {
  const { error } = await client.from(TABLE).insert({
    id: entry.id,
    url: entry.url,
    color: entry.color,
    transparency: entry.transparency,
    intensity: entry.intensity,
    region: entry.region,
    place: entry.place,
    created_at: new Date(entry.createdAt).toISOString(),
  });
  if (error) throw error;
}

async function fetchAllEntries() {
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;

  return data.map((row) => ({
    id: row.id,
    url: row.url,
    color: row.color,
    transparency: row.transparency,
    intensity: row.intensity,
    region: row.region,
    place: row.place,
    createdAt: new Date(row.created_at).getTime(),
  }));
}

async function deleteAllEntries() {
  const { error } = await client.from(TABLE).delete().not('id', 'is', null);
  if (error) throw error;

  // Storage list is paged; keep removing until the bucket is empty.
  for (;;) {
    const { data: files, error: listError } = await client.storage.from(BUCKET).list('', { limit: 1000 });
    if (listError) throw listError;
    const names = files.filter((f) => f.id).map((f) => f.name);
    if (names.length === 0) break;
    const { error: removeError } = await client.storage.from(BUCKET).remove(names);
    if (removeError) throw removeError;
  }
}

async function deleteEntry(id) {
  const { error } = await client.from(TABLE).delete().eq('id', id);
  if (error) throw error;
  const { error: removeError } = await client.storage.from(BUCKET).remove([`${id}.png`]);
  if (removeError) throw removeError;
}

module.exports = {
  get isConfigured() { return isConfigured; },
  get lastError() { return lastError; },
  // The project URL is not secret (browsers see it); the key is never exposed.
  get host() {
    try { return new URL((SUPABASE_URL || '').trim()).host; } catch { return SUPABASE_URL ? 'unparseable' : null; }
  },
  disable,
  uploadImage,
  insertEntry,
  fetchAllEntries,
  deleteAllEntries,
  deleteEntry,
};
