require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { writeSites } = require('../server/db');

const file = path.join(__dirname, '..', 'data', 'sites.json');
const sites = JSON.parse(fs.readFileSync(file, 'utf8'));

writeSites(sites)
  .then(() => console.log(`Seeded ${sites.length} sites into Supabase.`))
  .catch(err => { console.error(err); process.exit(1); });
