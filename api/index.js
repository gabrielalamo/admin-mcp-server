import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing required Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// Middleware
app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true
}));

// Authentication middleware
const authenticate = (req, res, next) => {
  const apiKey = process.env.MCP_API_KEY;
  
  if (!apiKey) {
    return next(); // No auth required if no key is set
  }
  
  const providedKey = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
  
  if (providedKey !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

// MCP Protocol Endpoints

// 1. List available tools (MCP standard)
app.get('/tools', authenticate, (req, res) => {
  res.json({
    tools: [
      {
        name: 'get_user_analytics',
        description: 'Get analytics about users including total, active, and new users',
        parameters: {
          type: 'object',
          properties: {
            startDate: {
              type: 'string',
              description: 'Start date in YYYY-MM-DD format',
              format: 'date'
            },
            endDate: {
              type: 'string',
              description: 'End date in YYYY-MM-DD format',
              format: 'date'
            }
          },
          required: []
        }
      },
      {
        name: 'get_payment_analytics',
        description: 'Get payment analytics including revenue and transaction data',
        parameters: {
          type: 'object',
          properties: {
            startDate: {
              type: 'string',
              description: 'Start date in YYYY-MM-DD format',
              format: 'date'
            },
            endDate: {
              type: 'string',
              description: 'End date in YYYY-MM-DD format',
              format: 'date'
            }
          },
          required: []
        }
      },
      {
        name: 'list_users',
        description: 'Get a list of all users in the system',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ]
  });
});

// 2. Execute tool (MCP standard)
app.post('/execute', authenticate, async (req, res) => {
  try {
    const { tool, arguments: args = {} } = req.body;
    
    if (!tool) {
      return res.status(400).json({ error: 'Tool name is required' });
    }
    
    let result;
    
    switch (tool) {
      case 'get_user_analytics':
        result = await getUserAnalytics(args);
        break;
        
      case 'get_payment_analytics':
        result = await getPaymentAnalytics(args);
        break;
        
      case 'list_users':
        result = await listUsers();
        break;
        
      default:
        return res.status(400).json({ error: `Unknown tool: ${tool}` });
    }
    
    res.json({ result });
  } catch (error) {
    console.error('Error executing tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Server info endpoint
app.get('/', authenticate, (req, res) => {
  res.json({
    name: 'Analytics MCP Server',
    version: '1.0.0',
    protocol: 'mcp',
    capabilities: {
      tools: true,
      resources: false,
      prompts: false
    }
  });
});

// Tool implementations
async function getUserAnalytics(params = {}) {
  const { startDate, endDate } = params;
  
  // Get total users
  const { count: totalUsers } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });
  
  // Get active users (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: activeUsers } = await supabase
    .from('profiles')
    .select('id')
    .gte('updated_at', thirtyDaysAgo);
  
  // Get new users in date range
  let newUsers = 0;
  if (startDate && endDate) {
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startDate)
      .lte('created_at', endDate);
    newUsers = count || 0;
  }
  
  return {
    totalUsers: totalUsers || 0,
    activeUsers: activeUsers?.length || 0,
    newUsers,
    lastUpdated: new Date().toISOString()
  };
}

async function getPaymentAnalytics(params = {}) {
  const { startDate, endDate } = params;
  
  let query = supabase.from('payments').select('amount, status, created_at');
  
  if (startDate && endDate) {
    query = query.gte('created_at', startDate).lte('created_at', endDate);
  }
  
  const { data: payments } = await query;
  
  const totalRevenue = payments
    ?.filter(p => p.status === 'completed')
    ?.reduce((sum, p) => sum + p.amount, 0) || 0;
  
  const totalTransactions = payments?.length || 0;
  const completedTransactions = payments?.filter(p => p.status === 'completed')?.length || 0;
  const conversionRate = totalTransactions > 0 
    ? (completedTransactions / totalTransactions) * 100 
    : 0;
  
  return {
    totalRevenue,
    totalTransactions,
    completedTransactions,
    conversionRate: conversionRate.toFixed(2),
    lastUpdated: new Date().toISOString()
  };
}

async function listUsers() {
  const { data: users } = await supabase
    .from('profiles')
    .select('id, email, name, created_at, role')
    .limit(100)
    .order('created_at', { ascending: false });
  
  return {
    users: users || [],
    count: users?.length || 0,
    lastUpdated: new Date().toISOString()
  };
}

// Legacy endpoints for compatibility
app.get('/mcp/tools', authenticate, (req, res) => {
  res.redirect('/tools');
});

app.post('/mcp/call', authenticate, async (req, res) => {
  const { method, params } = req.body;
  // Transform to new format
  req.body = { tool: method, arguments: params };
  // Forward to execute endpoint
  return app._router.handle(req, res);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  / - Server info');
  console.log('  GET  /tools - List available tools');
  console.log('  POST /execute - Execute a tool');
});
