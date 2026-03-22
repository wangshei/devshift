const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'devshift.db');
const PORT = parseInt(process.env.DEVSHIFT_PORT || '3847', 10);

module.exports = { DATA_DIR, DB_PATH, PORT };
