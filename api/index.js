import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import winston from 'winston';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  logger.error('Missing required Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// Middleware
app.use(helmet());
app.use(express.json());

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Authentication middleware
const authenticate = (req, res, next) => {
  const apiKey = process.env.MCP_API_KEY;
  
  // If no API key is configured, allow all requests (development mode)
  if (!apiKey) {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  
  const token = authHeader.substring(7);
  
  if (token !== apiKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// MCP Tools endpoint
app.get('/mcp/tools', authenticate, async (req, res) => {
  try {
    const tools = [
      {
        name: 'get_user_analytics',
        description: 'Obtém análises detalhadas de usuários',
        inputSchema: {
          type: 'object',
          properties: {
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' }
          }
        }
      },
      {
        name: 'get_payment_analytics',
        description: 'Obtém análises de pagamentos',
        inputSchema: {
          type: 'object',
          properties: {
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' }
          }
        }
      },
      {
        name: 'manage_user',
        description: 'Gerencia usuários do sistema',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'update', 'delete'] },
            userId: { type: 'string' },
            data: { type: 'object' }
          },
          required: ['action']
        }
      }
    ];
    
    res.json({ tools });
  } catch (error) {
    logger.error('Error in /mcp/tools:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// MCP Call endpoint
app.post('/mcp/call', authenticate, async (req, res) => {
  try {
    const { method, params } = req.body;
    
    if (!method) {
      return res.status(400).json({ error: 'Method is required' });
    }
    
    logger.info(`MCP Call: ${method}`, { params });
    
    let result;
    
    switch (method) {
      case 'get_user_analytics':
        result = await getUserAnalytics(params);
        break;
        
      case 'get_payment_analytics':
        result = await getPaymentAnalytics(params);
        break;
        
      case 'manage_user':
        result = await manageUser(params);
        break;
        
      default:
        return res.status(400).json({ error: `Unknown method: ${method}` });
    }
    
    res.json({ result });
  } catch (error) {
    logger.error('Error in /mcp/call:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Tool implementations
async function getUserAnalytics(params) {
  const { startDate, endDate } = params || {};
  
  // Get total users
  const { count: totalUsers, error: totalError } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });
    
  if (totalError) throw totalError;
  
  // Get active users (users who logged in recently)
  const { data: activeUsers, error: activeError } = await supabase
    .from('profiles')
    .select('id')
    .gte('updated_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    
  if (activeError) throw activeError;
  
  // Get new users (if date range provided)
  let newUsers = 0;
  if (startDate && endDate) {
    const { count, error } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startDate)
      .lte('created_at', endDate);
      
    if (error) throw error;
    newUsers = count || 0;
  }
  
  return {
    totalUsers: totalUsers || 0,
    activeUsers: activeUsers?.length || 0,
    newUsers,
    lastUpdated: new Date().toISOString()
  };
}

async function getPaymentAnalytics(params) {
  const { startDate, endDate } = params || {};
  
  let query = supabase
    .from('payments')
    .select('amount, status, created_at');
    
  if (startDate && endDate) {
    query = query
      .gte('created_at', startDate)
      .lte('created_at', endDate);
  }
  
  const { data: payments, error } = await query;
  
  if (error) throw error;
  
  const totalRevenue = payments
    ?.filter(p => p.status === 'completed')
    ?.reduce((sum, p) => sum + p.amount, 0) || 0;
    
  const totalTransactions = payments?.length || 0;
  const completedTransactions = payments?.filter(p => p.status === 'completed')?.length || 0;
  
  return {
    totalRevenue,
    totalTransactions,
    completedTransactions,
    conversionRate: totalTransactions > 0 ? (completedTransactions / totalTransactions) * 100 : 0,
    lastUpdated: new Date().toISOString()
  };
}

async function manageUser(params) {
  const { action, userId, data } = params;
  
  switch (action) {
    case 'list':
      const { data: users, error: listError } = await supabase
        .from('profiles')
        .select('id, email, name, created_at, role')
        .limit(100);
        
      if (listError) throw listError;
      return { users };
      
    case 'update':
      if (!userId) throw new Error('userId is required for update action');
      
      const { data: updated, error: updateError } = await supabase
        .from('profiles')
        .update(data)
        .eq('id', userId)
        .select()
        .single();
        
      if (updateError) throw updateError;
      return { updated };
      
    case 'delete':
      if (!userId) throw new Error('userId is required for delete action');
      
      const { error: deleteError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);
        
      if (deleteError) throw deleteError;
      return { deleted: true };
      
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`MCP Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`CORS origins: ${allowedOrigins.join(', ')}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

export default app;
