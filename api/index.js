// Vercel serverless entry point: every non-static request is rewritten here
// (see vercel.json) and handled by the Express app.
module.exports = require('../server/index');
