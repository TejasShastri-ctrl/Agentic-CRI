import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './routes/api.js';
import dashboardRouter from './routes/dashboard.js';
import analyticsRouter from './routes/analytics.js';
import contactsRouter from './routes/contacts.js';
import actionsRouter from './routes/actions.js';
import { getBoss } from './services/boss.js';
import { startEmailProcessor } from './workers/emailProcessor.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Agentic CRM Intelligence API is running',
    version: '1.0.0',
  });
});

app.use('/api', apiRouter);
app.use('/dashboard', dashboardRouter);
app.use('/analytics', analyticsRouter);
app.use('/contacts', contactsRouter);
// made the same file for actions, drafts and audits for now
app.use('/', actionsRouter);


app.use((req, res, _next) => {
  res.status(404).json({
    error_code: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.url}`,
    details: null,
  });
});

// U-E-H middleware
app.use((err, req, res, _next) => {
  console.error(err);
  
  const isDev = process.env.NODE_ENV === 'development';
  const statusCode = err.status || err.statusCode || 500;
  
  res.status(statusCode).json({
    error_code: err.code || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected error occurred on the server',
    details: isDev ? { stack: err.stack, ...err } : null,
  });
});

const server = app.listen(PORT, async () => {
  try {
    await getBoss();
    await startEmailProcessor();
  } catch (err) {
    console.error('Failed to start pg-boss or worker', err);
  }
  console.log(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

export default server;
