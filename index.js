const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const axios = require('axios');
const FormData = require('form-data');

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

// Configuração da API do WhatsApp
const API_CONFIG = {
  baseUrl: 'http://localhost:21465',
  session: 'whatsapp-broadcast',
  secretKey: 'MY_SECRET_KEY' // Altere para uma chave segura
};

// Estado da sessão
let sessionStatus = {
  connected: false,
  qrCode: null,
  sessionId: 'whatsapp-broadcast',
  phoneNumber: null,
  name: null
};

// Funções para interagir com a API WPPConnect
async function startSession(socket) {
  try {
    console.log('Iniciando sessão WhatsApp...');
    
    // 1. Iniciar sessão
    const startResponse = await axios.post(`${API_CONFIG.baseUrl}/api/${API_CONFIG.session}/start-session`, {
      secretKey: API_CONFIG.secretKey,
      webhook: ''
    });
    
    console.log('Sessão iniciada:', startResponse.data);
    
    // 2. Obter status da sessão
    const statusResponse = await axios.get(`${API_CONFIG.baseUrl}/api/${API_CONFIG.session}/status-session`);
    
    if (statusResponse.data.status === 'QRCODE') {
      // 3. Se precisar de QR Code, obter e enviar
      const qrResponse = await axios.get(`${API_CONFIG.baseUrl}/api/${API_CONFIG.session}/qr-code`, {
        responseType: 'arraybuffer'
      });
      
      // Converter para base64
      const qrBase64 = Buffer.from(qrResponse.data, 'binary').toString('base64');
      sessionStatus.qrCode = `data:image/png;base64,${qrBase64}`;
      
      // Enviar QR para frontend
      if (socket) {
        socket.emit('qr', sessionStatus.qrCode);
        socket.emit('status', { 
          connected: false, 
          message: 'Escaneie o QR Code' 
        });
      }
      
      // Iniciar polling para verificar conexão
      checkConnection(socket);
      
    } else if (statusResponse.data.status === 'CONNECTED') {
      sessionStatus.connected = true;
      sessionStatus.phoneNumber = statusResponse.data.phone;
      sessionStatus.name = statusResponse.data.name;
      
      if (socket) {
        socket.emit('authenticated', {
          phone: sessionStatus.phoneNumber,
          name: sessionStatus.name
        });
        socket.emit('status', { 
          connected: true, 
          message: `Conectado como ${sessionStatus.name}` 
        });
      }
    }
    
  } catch (error) {
    console.error('Erro ao iniciar sessão:', error.message);
    
    // Se der erro, tentar modo fallback com QR code simulado
    if (socket) {
      socket.emit('error', 'API offline. Usando modo simulação.');
      generateFallbackQR(socket);
    }
  }
}

async function checkConnection(socket) {
  const interval = setInterval(async () => {
    try {
      const statusResponse = await axios.get(`${API_CONFIG.baseUrl}/api/${API_CONFIG.session}/status-session`);
      
      if (statusResponse.data.status === 'CONNECTED') {
        clearInterval(interval);
        
        sessionStatus.connected = true;
        sessionStatus.phoneNumber = statusResponse.data.phone;
        sessionStatus.name = statusResponse.data.name;
        sessionStatus.qrCode = null;
        
        if (socket) {
          socket.emit('authenticated', {
            phone: sessionStatus.phoneNumber,
            name: sessionStatus.name
          });
          socket.emit('status', { 
            connected: true, 
            message: `Conectado como ${sessionStatus.name}` 
          });
        }
      }
    } catch (error) {
      console.error('Erro ao verificar conexão:', error.message);
    }
  }, 3000); // Verificar a cada 3 segundos
}

function generateFallbackQR(socket) {
  // Gerar QR code fallback (para quando a API estiver offline)
  const qrData = JSON.stringify({
    sessionId: sessionStatus.sessionId,
    timestamp: Date.now(),
    fallback: true
  });
  
  QRCode.toDataURL(qrData, { width: 300 }, (err, url) => {
    if (err) return;
    
    sessionStatus.qrCode = url;
    
    if (socket) {
      socket.emit('qr', url);
      socket.emit('status', { 
        connected: false, 
        message: 'API offline. Modo simulação.' 
      });
    }
  });
}

async function sendMessageReal(phoneNumber, message) {
  try {
    // Formatar número para padrão internacional
    let phone = phoneNumber.replace(/\D/g, '');
    
    // Adicionar código do Brasil se não tiver
    if (phone.length === 11 && !phone.startsWith('55')) {
      phone = '55' + phone;
    } else if (phone.length === 10) {
      phone = '55' + phone;
    }
    
    // Enviar mensagem via API
    const response = await axios.post(`${API_CONFIG.baseUrl}/api/${API_CONFIG.session}/send-message`, {
      phone: phone + '@c.us',
      message: message,
      isGroup: false
    }, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_CONFIG.secretKey
      }
    });
    
    return {
      success: true,
      messageId: response.data.messageId,
      status: 'sent'
    };
    
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Rotas API
app.get('/api/status', async (req, res) => {
  try {
    // Tentar obter status real da API
    const statusResponse = await axios.get(`${API_CONFIG.baseUrl}/api/${API_CONFIG.session}/status-session`);
    
    sessionStatus.connected = statusResponse.data.status === 'CONNECTED';
    sessionStatus.phoneNumber = statusResponse.data.phone;
    sessionStatus.name = statusResponse.data.name;
    
    res.json({
      connected: sessionStatus.connected,
      hasQr: !!sessionStatus.qrCode,
      phone: sessionStatus.phoneNumber,
      name: sessionStatus.name,
      status: statusResponse.data.status
    });
    
  } catch (error) {
    // Se API offline, retornar status local
    res.json({
      connected: sessionStatus.connected,
      hasQr: !!sessionStatus.qrCode,
      phone: sessionStatus.phoneNumber,
      name: sessionStatus.name,
      status: 'API_OFFLINE',
      message: 'API WhatsApp offline'
    });
  }
});

app.get('/api/qr', async (req, res) => {
  if (sessionStatus.qrCode && !sessionStatus.connected) {
    res.json({ qr: sessionStatus.qrCode });
  } else {
    res.json({ qr: null, connected: sessionStatus.connected });
  }
});

app.get('/api/start-session', async (req, res) => {
  try {
    await startSession();
    res.json({ success: true, message: 'Sessão iniciada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/logout', async (req, res) => {
  try {
    await axios.post(`${API_CONFIG.baseURL}/api/${API_CONFIG.session}/logout-session`);
    
    sessionStatus.connected = false;
    sessionStatus.qrCode = null;
    sessionStatus.phoneNumber = null;
    sessionStatus.name = null;
    
    io.emit('disconnected');
    io.emit('status', { connected: false, message: 'Desconectado' });
    
    res.json({ success: true, message: 'Desconectado' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/upload-contacts', upload.single('contactsFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Processar números
    const contacts = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const phone = line.replace(/\D/g, '');
        
        // Validar número
        if (phone.length >= 10 && phone.length <= 13) {
          // Garantir que tem código do país
          let formatted = phone;
          if (phone.length === 11 && !phone.startsWith('55')) {
            formatted = '55' + phone;
          } else if (phone.length === 10) {
            formatted = '55' + phone;
          }
          return formatted;
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
      count: contacts.length,
      sample: contacts.slice(0, 3)
    });

  } catch (error) {
    console.error('Erro ao processar arquivo:', error);
    res.status(500).json({ error: 'Erro ao processar arquivo' });
  }
});

app.post('/api/send-messages', async (req, res) => {
  try {
    const { contacts, message } = req.body;

    if (!sessionStatus.connected) {
      // Se não estiver conectado, tentar verificar status
      try {
        const statusResponse = await axios.get(`${API_CONFIG.baseUrl}/api/${API_CONFIG.session}/status-session`);
        sessionStatus.connected = statusResponse.data.status === 'CONNECTED';
      } catch (error) {
        return res.status(400).json({ error: 'WhatsApp não está conectado' });
      }
    }

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'Lista de contatos inválida' });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Mensagem não pode estar vazia' });
    }

    // Limitar a 50 mensagens por vez
    const contactsToSend = contacts.slice(0, 50);
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < contactsToSend.length; i++) {
      const contact = contactsToSend[i];
      
      try {
        // Enviar mensagem REAL
        const result = await sendMessageReal(contact, message);
        
        if (result.success) {
          successCount++;
          results.push({
            contact: contact,
            status: 'success',
            message: 'Mensagem enviada',
            messageId: result.messageId
          });
          
          // Emitir progresso
          io.emit('message_progress', {
            current: i + 1,
            total: contactsToSend.length,
            contact: contact,
            status: 'success'
          });
        } else {
          errorCount++;
          results.push({
            contact: contact,
            status: 'error',
            message: result.error
          });
          
          io.emit('message_progress', {
            current: i + 1,
            total: contactsToSend.length,
            contact: contact,
            status: 'error'
          });
        }
        
        // Aguardar 2 segundos entre mensagens para evitar bloqueio
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        errorCount++;
        results.push({
          contact: contact,
          status: 'error',
          message: error.message
        });
        
        io.emit('message_progress', {
          current: i + 1,
          total: contactsToSend.length,
          contact: contact,
          status: 'error'
        });
      }
    }

    res.json({
      success: true,
      total: contactsToSend.length,
      sent: successCount,
      failed: errorCount,
      results: results,
      note: sessionStatus.connected ? 'Mensagens enviadas via API real' : 'Modo simulação'
    });

  } catch (error) {
    console.error('Erro ao enviar mensagens:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagens: ' + error.message });
  }
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id);

  // Enviar status atual
  socket.emit('status', { 
    connected: sessionStatus.connected,
    message: sessionStatus.connected ? `Conectado como ${sessionStatus.name}` : 'Desconectado'
  });

  socket.on('initialize', async () => {
    console.log('Inicializando WhatsApp REAL...');
    
    if (!sessionStatus.connected) {
      socket.emit('status', { 
        connected: false, 
        message: 'Conectando à API WhatsApp...' 
      });
      
      await startSession(socket);
    } else {
      socket.emit('authenticated', {
        phone: sessionStatus.phoneNumber,
        name: sessionStatus.name
      });
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
  console.log(`API WhatsApp: ${API_CONFIG.baseUrl}`);
  console.log(`Sessão: ${API_CONFIG.session}`);
});
