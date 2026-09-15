require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const { getDb } = require('./db');

const app = express();
const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = parseInt(process.env.API_PORT || '8000', 10);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));

// Initialize database
getDb();

app.use('/api', routes);

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

module.exports = app;
