const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configuração básica
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

// Configuração SIMPLES do Puppeteer
const puppeteerOptions = {
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ],
        headless: true,
        executablePath: '/usr/bin/google-chrome' // Caminho correto no Render
    }
};

// Variáveis
let client = null;
let isConnected = false;
let isSending = false;

// Iniciar WhatsApp
function startWhatsApp() {
    console.log('🚀 Iniciando WhatsApp...');
    
    // Limpar cliente anterior
    if (client) {
        try {
            client.destroy();
        } catch (e) {}
    }
    
    client = new Client({
        authStrategy: new LocalAuth({ clientId: 'render-bot' }),
        ...puppeteerOptions
    });
    
    // Eventos
    client.on('qr', async (qr) => {
        console.log('📱 QR Code gerado');
        try {
            const qrImage = await qrcode.toDataURL(qr);
            io.emit('qr', qrImage);
        } catch (e) {
            io.emit('qr-text', qr);
        }
    });
    
    client.on('ready', () => {
        console.log('✅ WhatsApp conectado!');
        isConnected = true;
        io.emit('ready');
        io.emit('status', { connected: true, message: 'Pronto para enviar!' });
    });
    
    client.on('disconnected', () => {
        console.log('❌ WhatsApp desconectado');
        isConnected = false;
        io.emit('status', { connected: false, message: 'Desconectado' });
        setTimeout(startWhatsApp, 5000);
    });
    
    // Inicializar
    client.initialize().catch(err => {
        console.error('❌ Erro ao iniciar:', err.message);
        setTimeout(startWhatsApp, 10000);
    });
}

// Socket.io
io.on('connection', (socket) => {
    console.log('👤 Usuário conectado');
    
    socket.emit('status', { 
        connected: isConnected, 
        message: isConnected ? 'Conectado' : 'Desconectado' 
    });
    
    socket.on('connect-whatsapp', () => {
        console.log('🔄 Solicitando conexão');
        if (!isConnected) {
            startWhatsApp();
        }
    });
    
    socket.on('send-messages', async (data) => {
        if (!isConnected) {
            socket.emit('send-error', 'Conecte o WhatsApp primeiro');
            return;
        }
        
        isSending = true;
        const numbers = data.recipients.filter(n => n.trim());
        let sent = 0;
        
        for (const num of numbers) {
            if (!isSending) break;
            
            try {
                const phone = num.replace(/\D/g, '') + '@c.us';
                await client.sendMessage(phone, data.message);
                sent++;
                
                socket.emit('send-progress', {
                    sent,
                    total: numbers.length,
                    number: num,
                    status: '✅'
                });
                
                // Aguardar
                if (sent < numbers.length) {
                    await new Promise(r => setTimeout(r, data.delay * 1000));
                }
            } catch (err) {
                console.log('Erro:', err.message);
            }
        }
        
        isSending = false;
        socket.emit('send-complete');
    });
    
    socket.on('stop-sending', () => {
        isSending = false;
    });
});

// Rota de saúde
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        whatsapp: isConnected ? 'connected' : 'disconnected',
        time: new Date().toISOString()
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: https://seu-app.onrender.com`);
    
    // Iniciar WhatsApp
    setTimeout(startWhatsApp, 2000);
});
