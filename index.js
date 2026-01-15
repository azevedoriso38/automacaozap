const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const multer = require('multer');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');

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

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({ storage: storage });

// Criar diretório de uploads se não existir
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Estado do cliente WhatsApp
let client = null;
let isAuthenticated = false;
let qrCodeData = null;

// Inicializar cliente WhatsApp
function initializeWhatsAppClient(socket) {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  // Gerar QR Code
  client.on('qr', (qr) => {
    console.log('QR Code recebido');
    qrCodeData = qr;
    qrcode.generate(qr, { small: true });
    
    // Enviar QR code para o frontend via socket
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
    
    if (socket) {
      socket.emit('disconnected', reason);
    }
  });

  // Inicializar
  client.initialize();
}

// Rota para verificar status
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: isAuthenticated,
    hasQr: !!qrCodeData
  });
});

// Rota para obter QR code
app.get('/api/qr', (req, res) => {
  if (qrCodeData && !isAuthenticated) {
    res.json({ qr: qrCodeData });
  } else {
    res.json({ qr: null, authenticated: isAuthenticated });
  }
});

// Rota para desconectar
app.get('/api/logout', async (req, res) => {
  if (client) {
    await client.logout();
    await client.destroy();
    client = null;
    isAuthenticated = false;
    qrCodeData = null;
  }
  res.json({ success: true, message: 'Desconectado com sucesso' });
});

// Rota para processar contatos via upload de arquivo
app.post('/api/upload-contacts', upload.single('contactsFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Processar o arquivo (supondo que seja CSV ou TXT com um contato por linha)
    const contacts = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Remover caracteres não numéricos
        const phone = line.replace(/\D/g, '');
        // Formatar número para o padrão internacional
        if (phone.length === 11 && phone.startsWith('55')) {
          return phone + '@c.us';
        } else if (phone.length === 13 && phone.startsWith('55')) {
          return phone + '@c.us';
        } else if (phone.length === 12 && phone.startsWith('55')) {
          return phone + '@c.us';
        } else if (phone.length === 11) {
          return '55' + phone + '@c.us';
        } else if (phone.length === 10) {
          return '55' + phone + '@c.us';
        }
        return null;
      })
      .filter(phone => phone !== null);

    // Limpar arquivo após processamento
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      contacts: contacts,
      count: contacts.length
    });

  } catch (error) {
    console.error('Erro ao processar arquivo:', error);
    res.status(500).json({ error: 'Erro ao processar arquivo de contatos' });
  }
});

// Rota para enviar mensagens
app.post('/api/send-messages', async (req, res) => {
  try {
    const { contacts, message } = req.body;

    if (!client || !isAuthenticated) {
      return res.status(400).json({ error: 'WhatsApp não está conectado' });
    }

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'Lista de contatos inválida' });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Mensagem não pode estar vazia' });
    }

    const results = [];
    
    // Enviar mensagens para cada contato
    for (const contact of contacts) {
      try {
        // Verificar se o contato existe
        const isRegistered = await client.isRegisteredUser(contact);
        
        if (isRegistered) {
          await client.sendMessage(contact, message);
          results.push({
            contact: contact,
            status: 'success',
            message: 'Mensagem enviada com sucesso'
          });
        } else {
          results.push({
            contact: contact,
            status: 'error',
            message: 'Número não registrado no WhatsApp'
          });
        }
        
        // Pequena pausa para evitar bloqueio
        await new Promise(resolve => setTimeout(resolve, 1000));
        
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
      results: results
    });

  } catch (error) {
    console.error('Erro ao enviar mensagens:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagens' });
  }
});

// Socket.io para comunicação em tempo real
io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id);

  socket.on('initialize', () => {
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

// Rota principal para servir o frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
});
