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

// CORS configuration - Totalmente aberto para OpenAI
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'openai-conversation-id', 'openai-ephemeral-user-id'],
  exposedHeaders: ['Content-Length', 'X-Knowledge-Base', 'X-OpenAI-Functions'],
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
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, openai-conversation-id, openai-ephemeral-user-id');
  res.sendStatus(200);
});

// OpenAI Plugin Manifest (necessário para auto-discovery)
app.get('/.well-known/ai-plugin.json', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol;
  
  res.json({
    schema_version: "v1",
    name_for_human: "Admin Analytics MCP",
    name_for_model: "admin_analytics",
    description_for_human: "Get user analytics, payment data, and manage users",
    description_for_model: "Plugin for getting user analytics, payment analytics, and managing users. Use this whenever the user asks about users, payments, or analytics data.",
    auth: {
      type: "none"
    },
    api: {
      type: "openapi",
      url: `${protocol}://${host}/openapi.yaml`
    },
    logo_url: `${protocol}://${host}/logo.png`,
    contact_email: "support@example.com",
    legal_info_url: `${protocol}://${host}/legal`
  });
});

// Logo placeholder
app.get('/logo.png', (req, res) => {
  // Return a simple 1x1 transparent PNG
  const img = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': img.length
  });
  res.end(img);
});

// Legal page
app.get('/legal', (req, res) => {
  res.send('Legal information for Admin Analytics MCP');
});

// OpenAPI specification in YAML format (OpenAI prefers YAML)
app.get('/openapi.yaml', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol;
  
  const yaml = `openapi: 3.0.1
info:
  title: Admin Analytics MCP API
  description: API for user analytics, payment analytics, and user management
  version: 'v1'
servers:
  - url: ${protocol}://${host}
paths:
  /functions/get_user_analytics:
    post:
      operationId: getUserAnalytics
      summary: Get user analytics data
      description: Returns analytics about users including total users, active users, and new users for a date range
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                startDate:
                  type: string
                  format: date
                  description: Start date for analytics in YYYY-MM-DD format
                endDate:
                  type: string
                  format: date
                  description: End date for analytics in YYYY-MM-DD format
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  totalUsers:
                    type: integer
                    description: Total number of users in the system
                  activeUsers:
                    type: integer
                    description: Number of active users in the last 30 days
                  newUsers:
                    type: integer
                    description: Number of new users in the specified date range
                  lastUpdated:
                    type: string
                    format: date-time
                    description: Timestamp of when the data was last updated
  
  /functions/get_payment_analytics:
    post:
      operationId: getPaymentAnalytics
      summary: Get payment analytics data
      description: Returns analytics about payments including revenue, transactions, and conversion rates
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                startDate:
                  type: string
                  format: date
                  description: Start date for analytics in YYYY-MM-DD format
                endDate:
                  type: string
                  format: date
                  description: End date for analytics in YYYY-MM-DD format
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  totalRevenue:
                    type: number
                    description: Total revenue in the period
                  totalTransactions:
                    type: integer
                    description: Total number of transactions
                  completedTransactions:
                    type: integer
                    description: Number of completed transactions
                  conversionRate:
                    type: number
                    description: Conversion rate percentage
                  lastUpdated:
                    type: string
                    format: date-time
  
  /functions/manage_user:
    post:
      operationId: manageUser
      summary: Manage system users
      description: List, update, or delete users in the system
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - action
              properties:
                action:
                  type: string
                  enum: [list, update, delete]
                  description: The action to perform
                userId:
                  type: string
                  description: User ID (required for update and delete)
                data:
                  type: object
                  description: User data for update
                  properties:
                    name:
                      type: string
                    email:
                      type: string
                    role:
                      type: string
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  users:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                        email:
                          type: string
                        name:
                          type: string
                        role:
                          type: string
                        created_at:
                          type: string
                          format: date-time
                  updated:
                    type: object
                  deleted:
                    type: boolean`;
    
  res.set('Content-Type', 'text/yaml');
  res.send(yaml);
});

// OpenAPI JSON alternative
app.get('/openapi.json', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol;
  
  res.json({
    openapi: '3.0.1',
    info: {
      title: 'Admin Analytics MCP API',
      description: 'API for user analytics, payment analytics, and user management',
      version: 'v1'
    },
    servers: [
      {
        url: `${protocol}://${host}`
      }
    ],
    paths: {
      '/functions/get_user_analytics': {
        post: {
          operationId: 'getUserAnalytics',
          summary: 'Get user analytics data',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    startDate: {
                      type: 'string',
                      format: 'date'
                    },
                    endDate: {
                      type: 'string',
                      format: 'date'
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object'
                  }
                }
              }
            }
          }
        }
      },
      '/functions/get_payment_analytics': {
        post: {
          operationId: 'getPaymentAnalytics',
          summary: 'Get payment analytics data',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    startDate: {
                      type: 'string',
                      format: 'date'
                    },
                    endDate: {
                      type: 'string',
                      format: 'date'
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Successful response'
            }
          }
        }
      },
      '/functions/manage_user': {
        post: {
          operationId: 'manageUser',
          summary: 'Manage system users',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['action'],
                  properties: {
                    action: {
                      type: 'string',
                      enum: ['list', 'update', 'delete']
                    },
                    userId: {
                      type: 'string'
                    },
                    data: {
                      type: 'object'
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Successful response'
            }
          }
        }
      }
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Admin Analytics MCP Server',
    version: '1.0.0',
    status: 'online',
    openai_plugin: '/.well-known/ai-plugin.json',
    openapi_spec: '/openapi.yaml',
    endpoints: {
      functions: {
        get_user_analytics: 'POST /functions/get_user_analytics',
        get_payment_analytics: 'POST /functions/get_payment_analytics',
        manage_user: 'POST /functions/manage_user'
      }
    }
  });
});

// Function endpoints in OpenAI expected format
app.post('/functions/get_user_analytics', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.body || {};
    const result = await getUserAnalytics({ startDate, endDate });
    res.json(result);
  } catch (error) {
    logger.error('Error in get_user_analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/functions/get_payment_analytics', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.body || {};
    const result = await getPaymentAnalytics({ startDate, endDate });
    res.json(result);
  } catch (error) {
    logger.error('Error in get_payment_analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/functions/manage_user', authenticate, async (req, res) => {
  try {
    const { action, userId, data } = req.body;
    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }
    const result = await manageUser({ action, userId, data });
    res.json(result);
  } catch (error) {
    logger.error('Error in manage_user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Legacy MCP endpoints (mantém compatibilidade)
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    method: req.method,
    hint: 'Check /.well-known/ai-plugin.json for OpenAI plugin info'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`MCP Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`OpenAI Plugin manifest at /.well-known/ai-plugin.json`);
  logger.info(`OpenAPI spec at /openapi.yaml`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

export default app;
