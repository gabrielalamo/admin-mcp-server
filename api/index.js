import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware
app.use(express.json());

// CORS manual para ter controle total
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Root - Info do servidor MCP
app.get('/', (req, res) => {
  res.json({
    mcp: {
      version: "1.0.0",
      name: "Analytics MCP Server",
      description: "User and payment analytics"
    }
  });
});

// Listar ferramentas
app.get('/tools', (req, res) => {
  res.json({
    tools: [
      {
        name: "get_user_analytics",
        description: "Get user statistics",
        parameters: {
          type: "object",
          properties: {
            startDate: { type: "string" },
            endDate: { type: "string" }
          }
        }
      },
      {
        name: "get_payment_analytics",
        description: "Get payment statistics",
        parameters: {
          type: "object",
          properties: {
            startDate: { type: "string" },
            endDate: { type: "string" }
          }
        }
      },
      {
        name: "list_users",
        description: "List all users",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    ]
  });
});

// Executar ferramenta
app.post('/execute', async (req, res) => {
  const { tool, arguments: args = {} } = req.body;
  
  try {
    let result;
    
    switch (tool) {
      case 'get_user_analytics':
        const { count: totalUsers } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true });
        
        result = {
          totalUsers: totalUsers || 0,
          activeUsers: 0,
          newUsers: 0
        };
        break;
        
      case 'get_payment_analytics':
        result = {
          totalRevenue: 0,
          totalTransactions: 0,
          completedTransactions: 0,
          conversionRate: 0
        };
        break;
        
      case 'list_users':
        const { data: users } = await supabase
          .from('profiles')
          .select('id, email, name')
          .limit(10);
        
        result = { users: users || [] };
        break;
        
      default:
        return res.status(400).json({ error: `Unknown tool: ${tool}` });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Compatibilidade com Lovable
app.get('/mcp/tools', (req, res) => {
  res.redirect('/tools');
});

app.post('/mcp/call', async (req, res) => {
  req.body = { 
    tool: req.body.method, 
    arguments: req.body.params 
  };
  req.url = '/execute';
  return app.handle(req, res);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
