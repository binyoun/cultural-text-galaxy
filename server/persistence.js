const { createClient } = require('@supabase/supabase-js');

// Optional persistence layer. Local dev and testing stay exactly as before,
// in-memory only, when these env vars aren't set. On Render (or anywhere
// running the actual online workshop) set SUPABASE_URL and
// SUPABASE_SERVICE_KEY so entries and images survive a server restart or
// redeploy instead of living only in memory / on an ephemeral disk.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'handwriting-uploads';
const TABLE = 'entries';

const isConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

const client = isConfigured ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

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

module.exports = { isConfigured, uploadImage, insertEntry, fetchAllEntries };
