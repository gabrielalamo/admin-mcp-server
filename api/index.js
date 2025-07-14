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
app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(express.json());

// CORS configuration - Aberto para testes
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Knowledge-Base'],
  maxAge: 86400
}));

// Authentication middleware
const authenticate = (req, res, next) => {
  // Skip authentication for OPTIONS requests
  if (req.method === 'OPTIONS') {
    return next();
  }
  
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

// Handle preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.sendStatus(200);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// OpenAI Compatible Functions Format
const openAIFunctions = [
  {
    name: 'get_user_analytics',
    description: 'Get detailed user analytics including total users, active users, and new users for a specific date range',
    parameters: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date for analytics in YYYY-MM-DD format'
        },
        endDate: {
          type: 'string',
          description: 'End date for analytics in YYYY-MM-DD format'
        }
      },
      required: []
    }
  },
  {
    name: 'get_payment_analytics',
    description: 'Get payment analytics including total revenue, transaction counts, and conversion rates',
    parameters: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date for analytics in YYYY-MM-DD format'
        },
        endDate: {
          type: 'string',
          description: 'End date for analytics in YYYY-MM-DD format'
        }
      },
      required: []
    }
  },
  {
    name: 'manage_user',
    description: 'Manage system users - list all users, update user data, or delete a user',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'update', 'delete'],
          description: 'Action to perform: list (get all users), update (modify user data), or delete (remove user)'
        },
        userId: {
          type: 'string',
          description: 'User ID (required for update and delete actions)'
        },
        data: {
          type: 'object',
          description: 'User data to update (required for update action)',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' }
          }
        }
      },
      required: ['action']
    }
  }
];

// OpenAI-compatible endpoint for function discovery
app.get('/openai/functions', authenticate, (req, res) => {
  res.json({
    functions: openAIFunctions,
    server_info: {
      name: 'Admin MCP Server',
      version: '1.0.0',
      description: 'Server for user and payment analytics'
    }
  });
});

// Alternative endpoint that might be expected by OpenAI
app.get('/functions', authenticate, (req, res) => {
  res.json({
    functions: openAIFunctions
  });
});

// MCP Tools endpoint (mantém compatibilidade)
app.get('/mcp/tools', authenticate, async (req, res) => {
  try {
    const tools = openAIFunctions.map(func => ({
      name: func.name,
      description: func.description,
      inputSchema: func.parameters
    }));
    
    res.json({ tools });
  } catch (error) {
    logger.error('Error in /mcp/tools:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// OpenAI-compatible function execution endpoint
app.post('/openai/execute', authenticate, async (req, res) => {
  try {
    const { function_name, arguments: args } = req.body;
    
    if (!function_name) {
      return res.status(400).json({ error: 'function_name is required' });
    }
    
    logger.info(`OpenAI Function Call: ${function_name}`, { arguments: args });
    
    let result;
    
    switch (function_name) {
      case 'get_user_analytics':
        result = await getUserAnalytics(args);
        break;
        
      case 'get_payment_analytics':
        result = await getPaymentAnalytics(args);
        break;
        
      case 'manage_user':
        result = await manageUser(args);
        break;
        
      default:
        return res.status(400).json({ error: `Unknown function: ${function_name}` });
    }
    
    res.json({ result });
  } catch (error) {
    logger.error('Error in /openai/execute:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// MCP Call endpoint (mantém compatibilidade)
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

// OpenAPI/Swagger endpoint for better compatibility
app.get('/openapi.json', (req, res) => {
  const openApiSpec = {
    openapi: '3.0.0',
    info: {
      title: 'Admin MCP Server API',
      version: '1.0.0',
      description: 'API for user and payment analytics'
    },
    servers: [
      {
        url: `https://${req.get('host')}`,
        description: 'Production server'
      }
    ],
    paths: {
      '/openai/functions': {
        get: {
          summary: 'List available functions',
          responses: {
            '200': {
              description: 'List of available functions',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      functions: {
                        type: 'array',
                        items: {
                          type: 'object'
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/openai/execute': {
        post: {
          summary: 'Execute a function',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    function_name: { type: 'string' },
                    arguments: { type: 'object' }
                  },
                  required: ['function_name']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Function execution result'
            }
          }
        }
      }
    }
  };
  
  res.json(openApiSpec);
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

// Root endpoint with API information
app.get('/', (req, res) => {
  res.json({
    name: 'Admin MCP Server',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      health: '/health',
      mcp_tools: '/mcp/tools',
      mcp_call: '/mcp/call',
      openai_functions: '/openai/functions',
      openai_execute: '/openai/execute',
      openapi_spec: '/openapi.json'
    },
    documentation: 'Use /openai/functions to discover available functions and /openai/execute to call them'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    method: req.method,
    available_endpoints: ['/health', '/mcp/tools', '/mcp/call', '/openai/functions', '/openai/execute', '/openapi.json']
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  
  // CORS error específico
  if (error.message && error.message.includes('CORS')) {
    return res.status(403).json({ 
      error: 'CORS policy error',
      message: error.message,
      origin: req.headers.origin || 'no origin'
    });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`MCP Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`CORS origins: *`);
  logger.info(`OpenAI endpoints available at /openai/functions and /openai/execute`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

export default app;
