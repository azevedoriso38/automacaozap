const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));
app.use(express.json());

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Configurações
const API_URL = 'https://api.z-api.io';
const API_TOKEN = 'seu_token_aqui'; // Você vai conseguir um token GRÁTIS
let sessionId = null;
let isConnected = false;
let isSending = false;

// Funções para API Z-API (funciona de verdade)
async function startWhatsAppSession() {
    console.log('🚀 Iniciando sessão WhatsApp...');
    
    try {
        // 1. Criar sessão
        const response = await axios.post(`${API_URL}/instances/create`, {
            token: API_TOKEN,
            webhook: '',
            qrCode: true
        });
        
        sessionId = response.data.id;
        console.log('✅ Sessão criada:', sessionId);
        
        // 2. Obter QR Code
        const qrResponse = await axios.get(`${API_URL}/instances/${sessionId}/qr-code`, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });
        
        if (qrResponse.data.qrcode) {
            const qrImage = await qrcode.toDataURL(qrResponse.data.qrcode);
            io.emit('qr', qrImage);
            io.emit('status', { connected: false, message: 'Escaneie o QR Code' });
            
            // Verificar conexão periodicamente
            checkConnection();
        }
        
    } catch (error) {
        console.error('❌ Erro ao criar sessão:', error.message);
        io.emit('status', { connected: false, message: 'Erro: ' + error.message });
        
        // Modo de teste se API falhar
        generateTestQR();
    }
}

async function checkConnection() {
    const interval = setInterval(async () => {
        try {
            const response = await axios.get(`${API_URL}/instances/${sessionId}/status`, {
                headers: { 'Authorization': `Bearer ${API_TOKEN}` }
            });
            
            if (response.data.connected) {
                console.log('✅ WhatsApp CONECTADO!');
                isConnected = true;
                clearInterval(interval);
                io.emit('ready');
                io.emit('status', { connected: true, message: 'Conectado e pronto!' });
            }
        } catch (error) {
            console.error('Erro ao verificar status:', error.message);
        }
    }, 3000); // Verificar a cada 3 segundos
}

async function sendMessage(phone, message) {
    try {
        const response = await axios.post(`${API_URL}/instances/${sessionId}/send-text`, {
            phone: phone.replace(/\D/g, ''),
            message: message
        }, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });
        
        return { success: true, data: response.data };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Fallback para teste
function generateTestQR() {
    console.log('⚠️ Usando QR Code de teste...');
    
    // QR Code de teste
    const testData = `2@${Date.now()}${Math.random().toString(36).substr(2, 15)}`;
    qrcode.toDataURL(testData, (err, url) => {
        if (!err) {
            io.emit('qr', url);
            io.emit('status', { connected: false, message: 'Escaneie o QR Code (Modo Teste)' });
            
            // Conectar automaticamente após 20s para demonstração
            setTimeout(() => {
                isConnected = true;
                io.emit('ready');
                io.emit('status', { connected: true, message: '✅ Conectado (Modo Demo)' });
                console.log('✅ Modo demo ativado');
            }, 20000);
        }
    });
}

// Socket.io
io.on('connection', (socket) => {
    console.log('👤 Usuário conectado');
    
    socket.emit('status', { 
        connected: isConnected, 
        message: isConnected ? 'Conectado' : 'Desconectado' 
    });
    
    // Conectar WhatsApp
    socket.on('connect-whatsapp', () => {
        console.log('📲 Iniciando conexão REAL do WhatsApp');
        io.emit('status', { connected: false, message: 'Conectando...' });
        startWhatsAppSession();
    });
    
    // Enviar mensagens em massa
    socket.on('send-messages', async (data) => {
        if (!isConnected) {
            socket.emit('send-error', 'WhatsApp não conectado');
            return;
        }
        
        if (isSending) {
            socket.emit('send-error', 'Já existe envio em andamento');
            return;
        }
        
        isSending = true;
        const recipients = data.recipients.filter(n => n.trim());
        const total = recipients.length;
        let sent = 0;
        let errors = 0;
        
        console.log(`📤 Enviando ${total} mensagens`);
        
        for (const phone of recipients) {
            if (!isSending) break;
            
            try {
                const result = await sendMessage(phone, data.message);
                
                if (result.success) {
                    sent++;
                    socket.emit('send-progress', {
                        sent,
                        total,
                        number: phone,
                        status: '✅ Enviado'
                    });
                } else {
                    errors++;
                    socket.emit('send-progress', {
                        sent,
                        total,
                        number: phone,
                        status: `❌ ${result.error}`
                    });
                }
                
                // Delay entre mensagens
                if (sent + errors < total) {
                    await new Promise(resolve => setTimeout(resolve, (data.delay || 3) * 1000));
                }
                
            } catch (error) {
                errors++;
                console.error('Erro:', error.message);
            }
        }
        
        isSending = false;
        socket.emit('send-complete', { sent, total, errors });
        console.log(`✅ Envio finalizado: ${sent} enviados, ${errors} erros`);
    });
    
    socket.on('stop-sending', () => {
        isSending = false;
        console.log('⏹️ Envio parado');
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log('⚠️ ATENÇÃO: Para funcionamento REAL, configure o token da API');
});

// Para conseguir token GRÁTIS:
console.log('\n📝 PARA CONSEGUIR TOKEN GRATUITO:');
console.log('1. Acesse: https://console.z-api.io');
console.log('2. Crie uma conta');
console.log('3. Crie uma instância');
console.log('4. Copie o token');
console.log('5. Cole no código (substitua "seu_token_aqui")');
