const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const multer = require('multer');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configurações
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.urlencoded({ extended: true }));

// Configuração do Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Estado do WhatsApp
let client = null;
let isAuthenticated = false;
let qrCodeData = null;

// Configuração do Puppeteer para Render
const puppeteerOptions = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu'
  ],
  executablePath: process.env.CHROMIUM_PATH || 
                 process.env.PUPPETEER_EXECUTABLE_PATH || 
                 puppeteer.executablePath()
};

// Inicializar cliente WhatsApp
function initializeWhatsAppClient(socket) {
  console.log('Inicializando WhatsApp Web com Puppeteer...');
  
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: "whatsapp-broadcast"
    }),
    puppeteer: puppeteerOptions,
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
  });

  // Gerar QR Code
  client.on('qr', (qr) => {
    console.log('QR Code recebido');
    qrCodeData = qr;
    qrcode.generate(qr, { small: true });
    
    if (socket) {
      socket.emit('qr', qr);
    }
  });

  // Quando autenticado
  client.on('ready', () => {
    console.log('Cliente WhatsApp está pronto!');
    isAuthenticated = true;
    
    if (socket) {
      socket.emit('ready', 'WhatsApp conectado com sucesso!');
      socket.emit('authenticated');
    }
  });

  // Quando desconectado
  client.on('disconnected', (reason) => {
    console.log('Cliente WhatsApp desconectado:', reason);
    isAuthenticated = false;
    qrCodeData = null;
    
    if (socket) {
      socket.emit('disconnected', reason);
    }
  });

  // Erros
  client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação:', msg);
    if (socket) {
      socket.emit('error', 'Falha na autenticação');
    }
  });

  // Inicializar
  try {
    client.initialize();
  } catch (error) {
    console.error('Erro ao inicializar WhatsApp:', error);
    if (socket) {
      socket.emit('error', 'Erro ao inicializar: ' + error.message);
    }
  }
}

// Rotas API
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: isAuthenticated,
    hasQr: !!qrCodeData
  });
});

app.get('/api/qr', (req, res) => {
  if (qrCodeData && !isAuthenticated) {
    res.json({ qr: qrCodeData });
  } else {
    res.json({ qr: null, authenticated: isAuthenticated });
  }
});

app.get('/api/logout', async (req, res) => {
  if (client) {
    try {
      await client.logout();
      await client.destroy();
    } catch (err) {
      console.log('Erro ao desconectar:', err);
    }
    client = null;
    isAuthenticated = false;
    qrCodeData = null;
  }
  res.json({ success: true, message: 'Desconectado com sucesso' });
});

app.post('/api/upload-contacts', upload.single('contactsFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    const contacts = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const phone = line.replace(/\D/g, '');
        if (phone.length >= 10) {
          if (!phone.startsWith('55') && phone.length <= 11) {
            return '55' + phone + '@c.us';
          }
          return phone + '@c.us';
        }
        return null;
      })
      .filter(phone => phone !== null);

    // Limpar arquivo
    try {
      fs.unlinkSync(filePath);
    } catch (err) {}

    res.json({
      success: true,
      contacts: contacts,
      count: contacts.length
    });

  } catch (error) {
    console.error('Erro ao processar arquivo:', error);
    res.status(500).json({ error: 'Erro ao processar arquivo' });
  }
});

app.post('/api/send-messages', async (req, res) => {
  try {
    const { contacts, message } = req.body;

    if (!client || !isAuthenticated) {
      return res.status(400).json({ error: 'WhatsApp não conectado' });
    }

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'Lista de contatos inválida' });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Mensagem vazia' });
    }

    const results = [];
    
    for (const contact of contacts.slice(0, 50)) { // Limite de 50 contatos
      try {
        const isRegistered = await client.isRegisteredUser(contact);
        
        if (isRegistered) {
          await client.sendMessage(contact, message);
          results.push({
            contact: contact,
            status: 'success',
            message: 'Mensagem enviada'
          });
        } else {
          results.push({
            contact: contact,
            status: 'error',
            message: 'Número não registrado'
          });
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 segundos entre mensagens
        
      } catch (error) {
        results.push({
          contact: contact,
          status: 'error',
          message: error.message
        });
      }
    }

    res.json({
      success: true,
      total: contacts.length,
      sent: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'error').length,
      results: results
    });

  } catch (error) {
    console.error('Erro ao enviar mensagens:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagens' });
  }
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id);

  socket.on('initialize', () => {
    console.log('Inicializando WhatsApp...');
    if (!client || !isAuthenticated) {
      initializeWhatsAppClient(socket);
    } else if (isAuthenticated) {
      socket.emit('authenticated');
    } else if (qrCodeData) {
      socket.emit('qr', qrCodeData);
    }
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Puppeteer executável: ${puppeteerOptions.executablePath}`);
});
