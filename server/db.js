const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function readSites() {
  const { data, error } = await supabase
    .from('sites')
    .select('id, name, color, latlngs');
  if (error) throw error;
  return data;
}

async function writeSites(sites) {
  const { error: delErr } = await supabase.from('sites').delete().neq('id', '');
  if (delErr) throw delErr;
  if (sites.length === 0) return;
  const { error: insErr } = await supabase.from('sites').insert(sites);
  if (insErr) throw insErr;
}

module.exports = { readSites, writeSites };
