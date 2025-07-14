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

// Middleware - CORS totalmente aberto para OpenAI
app.use(cors({
  origin: '*',
  methods: '*',
  allowedHeaders: '*',
  exposedHeaders: '*',
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.json());

// Log todas as requisições para debug
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', req.body);
  }
  next();
});

// Handle OPTIONS requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.sendStatus(200);
});

// Root endpoint - MCP server info
app.get('/', (req, res) => {
  const response = {
    mcp_version: "1.0",
    name: "Analytics MCP Server",
    description: "MCP server for user and payment analytics",
    tools: [
      {
        name: "get_user_analytics",
        description: "Get user analytics data"
      },
      {
        name: "get_payment_analytics", 
        description: "Get payment analytics data"
      },
      {
        name: "list_users",
        description: "List all users"
      }
    ]
  };
  
  console.log('Sending root response:', response);
  res.json(response);
});

// MCP handshake endpoint
app.post('/handshake', (req, res) => {
  console.log('Handshake request received');
  res.json({
    status: "ok",
    mcp_version: "1.0",
    capabilities: {
      tools: true
    }
  });
});

// List tools endpoint
app.get('/tools', (req, res) => {
  const tools = [
    {
      name: "get_user_analytics",
      description: "Get analytics about users including total, active, and new users",
      input_schema: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: "Start date in YYYY-MM-DD format"
          },
          endDate: {
            type: "string",
            description: "End date in YYYY-MM-DD format"
          }
        }
      }
    },
    {
      name: "get_payment_analytics",
      description: "Get payment analytics including revenue and transaction data",
      input_schema: {
        type: "object", 
        properties: {
          startDate: {
            type: "string",
            description: "Start date in YYYY-MM-DD format"
          },
          endDate: {
            type: "string",
            description: "End date in YYYY-MM-DD format"
          }
        }
      }
    },
    {
      name: "list_users",
      description: "Get a list of all users in the system",
      input_schema: {
        type: "object",
        properties: {}
      }
    }
  ];
  
  console.log('Sending tools:', tools);
  res.json({ tools });
});

// Execute tool endpoint
app.post('/execute', async (req, res) => {
  try {
    console.log('Execute request:', req.body);
    
    const { tool, arguments: args = {} } = req.body;
    
    if (!tool) {
      return res.status(400).json({ error: "Tool name is required" });
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
    
    console.log('Sending result:', result);
    res.json(result);
  } catch (error) {
    console.error('Error executing tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// Tool call endpoint (alternative format)
app.post('/tool/call', async (req, res) => {
  console.log('Tool call request:', req.body);
  // Reuse execute logic
  return app._router.handle(
    Object.assign(req, { 
      url: '/execute',
      body: req.body 
    }), 
    res
  );
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
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

// Legacy MCP endpoints for compatibility
app.get('/mcp/tools', (req, res) => {
  res.redirect('/tools');
});

app.post('/mcp/call', async (req, res) => {
  const { method, params } = req.body;
  req.body = { tool: method, arguments: params };
  return app._router.handle(
    Object.assign(req, { url: '/execute' }), 
    res
  );
});

// Catch-all for debugging
app.use((req, res) => {
  console.log(`404 - Unhandled route: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Not found',
    message: `Cannot ${req.method} ${req.path}`,
    available_endpoints: [
      'GET /',
      'GET /tools',
      'POST /execute',
      'POST /handshake',
      'GET /health'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
  console.log('Server started at:', new Date().toISOString());
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
  });
});
