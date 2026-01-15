const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const axios = require('axios');

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

// Simulação do estado do WhatsApp
let whatsappStatus = {
  connected: false,
  qrCode: null,
  sessionId: Date.now().toString()
};

// Gerar QR Code simulado (na prática, você usaria uma API real)
function generateQRCode(socket) {
  // Em uma implementação real, você usaria uma API como:
  // - WPPConnect: https://github.com/wppconnect-team
  // - Venom Bot: https://github.com/orkestral/venom
  // - whatsapp-web.js com servidor separado
  
  const sessionData = {
    sessionId: whatsappStatus.sessionId,
    timestamp: Date.now()
  };
  
  const qrData = JSON.stringify(sessionData);
  
  // Gerar QR code como base64
  QRCode.toDataURL(qrData, { width: 300 }, (err, url) => {
    if (err) {
      console.error('Erro ao gerar QR code:', err);
      return;
    }
    
    whatsappStatus.qrCode = url;
    
    // Enviar para o frontend
    if (socket) {
      socket.emit('qr', url);
      socket.emit('status', { 
        connected: false, 
        message: 'Escaneie o QR Code com seu WhatsApp' 
      });
    }
  });
}

// Rotas API
app.get('/api/status', (req, res) => {
  res.json({
    connected: whatsappStatus.connected,
    hasQr: !!whatsappStatus.qrCode,
    sessionId: whatsappStatus.sessionId
  });
});

app.get('/api/qr', async (req, res) => {
  if (whatsappStatus.qrCode && !whatsappStatus.connected) {
    res.json({ qr: whatsappStatus.qrCode });
  } else {
    res.json({ qr: null, connected: whatsappStatus.connected });
  }
});

app.get('/api/connect', (req, res) => {
  whatsappStatus.connected = true;
  whatsappStatus.qrCode = null;
  
  // Emitir para todos os sockets conectados
  io.emit('authenticated');
  io.emit('status', { 
    connected: true, 
    message: 'WhatsApp conectado com sucesso!' 
  });
  
  res.json({ success: true, message: 'Conectado' });
});

app.get('/api/disconnect', (req, res) => {
  whatsappStatus.connected = false;
  whatsappStatus.qrCode = null;
  
  io.emit('disconnected');
  io.emit('status', { 
    connected: false, 
    message: 'Desconectado' 
  });
  
  res.json({ success: true, message: 'Desconectado' });
});

app.post('/api/upload-contacts', upload.single('contactsFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Processar números de telefone
    const contacts = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Extrair apenas números
        const phone = line.replace(/\D/g, '');
        
        // Validar e formatar (exemplo para Brasil)
        if (phone.length >= 10 && phone.length <= 13) {
          // Formatar para WhatsApp (código país + número)
          let formatted = phone;
          if (phone.length === 11 && phone.startsWith('55')) {
            formatted = phone; // Já tem código do país
          } else if (phone.length === 11) {
            formatted = '55' + phone; // Adicionar código do Brasil
          } else if (phone.length === 10) {
            formatted = '55' + phone; // Adicionar código do Brasil
          }
          return formatted;
        }
        return null;
      })
      .filter(phone => phone !== null);

    // Limpar arquivo
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.log('Erro ao deletar arquivo:', err);
    }

    res.json({
      success: true,
      contacts: contacts,
      count: contacts.length,
      sample: contacts.slice(0, 5) // Mostrar apenas 5 como exemplo
    });

  } catch (error) {
    console.error('Erro ao processar arquivo:', error);
    res.status(500).json({ error: 'Erro ao processar arquivo' });
  }
});

app.post('/api/send-messages', async (req, res) => {
  try {
    const { contacts, message } = req.body;

    if (!whatsappStatus.connected) {
      return res.status(400).json({ error: 'WhatsApp não está conectado' });
    }

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'Lista de contatos inválida' });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Mensagem não pode estar vazia' });
    }

    // Limitar a 10 contatos por vez para demonstração
    const limitedContacts = contacts.slice(0, 10);
    
    // Simular envio de mensagens
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < limitedContacts.length; i++) {
      const contact = limitedContacts[i];
      
      // Simular atraso entre mensagens
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Simular resultado (80% de sucesso, 20% de erro)
      const randomSuccess = Math.random() > 0.2;
      
      if (randomSuccess) {
        successCount++;
        results.push({
          contact: contact,
          status: 'success',
          message: 'Mensagem enviada com sucesso (simulado)',
          timestamp: new Date().toISOString()
        });
        
        // Emitir progresso em tempo real
        io.emit('message_progress', {
          current: i + 1,
          total: limitedContacts.length,
          contact: contact,
          status: 'success'
        });
      } else {
        errorCount++;
        results.push({
          contact: contact,
          status: 'error',
          message: 'Erro ao enviar (simulado)',
          timestamp: new Date().toISOString()
        });
        
        io.emit('message_progress', {
          current: i + 1,
          total: limitedContacts.length,
          contact: contact,
          status: 'error'
        });
      }
    }

    res.json({
      success: true,
      total: limitedContacts.length,
      sent: successCount,
      failed: errorCount,
      results: results,
      note: 'Esta é uma demonstração. Para envio real, conecte uma API de WhatsApp.'
    });

  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao processar envio' });
  }
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id);

  // Enviar status atual
  socket.emit('status', { 
    connected: whatsappStatus.connected,
    message: whatsappStatus.connected ? 'Conectado' : 'Desconectado'
  });

  socket.on('initialize', () => {
    console.log('Solicitando inicialização do WhatsApp...');
    
    if (!whatsappStatus.connected) {
      // Simular conexão após 2 segundos (para demonstração)
      socket.emit('status', { 
        connected: false, 
        message: 'Iniciando conexão...' 
      });
      
      setTimeout(() => {
        generateQRCode(socket);
      }, 1000);
    } else {
      socket.emit('authenticated');
    }
  });

  socket.on('simulate_scan', () => {
    // Simular escaneamento do QR code
    whatsappStatus.connected = true;
    whatsappStatus.qrCode = null;
    
    socket.emit('authenticated');
    socket.emit('status', { 
      connected: true, 
      message: 'WhatsApp conectado com sucesso!' 
    });
    
    // Emitir para todos
    io.emit('authenticated');
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
  console.log(`Acesse: http://localhost:${PORT}`);
});
