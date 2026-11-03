
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import clientRoutes from './routes/clients.js';
import loanRoutes from './routes/loans.js';
import reportRoutes from './routes/reports.js';
import staffRoutes from './routes/staff.js';

const app = express();

app.disable('x-powered-by');

app.use(helmet());

// Allow local development and the configured deployed frontend
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  process.env.CLIENT_ORIGIN
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(
      new Error(`CORS blocked origin: ${origin}`)
    );
  }
}));

app.use(express.json({ limit: '1mb' }));

// Limit login attempts
app.use(
  '/api/auth/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  })
);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/staff', staffRoutes);

// Central error handler
app.use((err, req, res, _next) => {
  console.error(err);

  if (err?.code === 11000) {
    return res.status(409).json({
      message: 'A record with that unique value already exists'
    });
  }

  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      message: err.message
    });
  }

  res.status(500).json({
    message: err.message || 'Internal server error'
  });
});

// Start server
const port = Number(process.env.PORT || 5000);

connectDB()
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`API listening on http://localhost:${port}`);
      console.log('Allowed frontend origins:', allowedOrigins);
    });
  })
  .catch(err => {
    console.error('Could not start server:', err.message);
    process.exit(1);
  });
