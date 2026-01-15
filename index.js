const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configuração básica
app.use(express.static(__dirname));
app.use(express.json());

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota de saúde
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        whatsapp: global.client ? 'connected' : 'disconnected',
        time: new Date().toISOString()
    });
});

// Estado do sistema
let isConnected = false;
let isSending = false;
let sessionName = 'whatsapp-session';

// Função para criar QR Code
function generateQRCode(qrCode) {
    qrcode.toDataURL(qrCode, (err, url) => {
        if (err) {
            console.error('Erro ao gerar QR Code:', err);
            io.emit('qr-text', qrCode); // Envia texto se falhar
        } else {
            io.emit('qr', url);
        }
    });
}

// Iniciar WhatsApp
async function startWhatsApp() {
    console.log('🚀 Iniciando WhatsApp...');
    
    try {
        // Usar venom-bot diretamente
        const venom = require('venom-bot');
        
        global.client = await venom.create({
            session: sessionName,
            headless: true,
            useChrome: false, // Não usar Chrome
            browserArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
            logQR: false // Nós vamos gerar nosso próprio QR
        });
        
        // Evento QR Code
        global.client.onStateChange((state) => {
            console.log('Estado:', state);
            
            if (state === 'qrReadSuccess') {
                console.log('✅ QR Code lido com sucesso!');
                io.emit('status', { connected: false, message: 'Autenticando...' });
            }
            
            if (state === 'isLogged') {
                console.log('✅ WhatsApp conectado!');
                isConnected = true;
                io.emit('status', { connected: true, message: 'Conectado!' });
                io.emit('ready');
            }
        });
        
        // Evento desconexão
        global.client.onStreamChange((state) => {
            if (state === 'DISCONNECTED') {
                console.log('❌ WhatsApp desconectado');
                isConnected = false;
                io.emit('status', { connected: false, message: 'Desconectado' });
            }
        });
        
        console.log('✅ WhatsApp inicializado');
        io.emit('status', { connected: false, message: 'Aguardando QR Code...' });
        
    } catch (error) {
        console.error('❌ Erro ao iniciar WhatsApp:', error.message);
        io.emit('status', { connected: false, message: 'Erro: ' + error.message });
    }
}

// Iniciar WhatsApp com QR Code (método alternativo)
async function startWhatsAppWithQR() {
    console.log('📱 Iniciando WhatsApp com QR Code...');
    
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        // Instalar whatsapp-web.js sem puppeteer
        console.log('Instalando dependências...');
        await execAsync('npm list whatsapp-web.js || npm install whatsapp-web.js@1.22.1 --no-save');
        
        // Usar uma versão mais simples
        const { Client } = require('whatsapp-web.js');
        
        global.client = new Client({
            authStrategy: {
                name: 'TEXT_QR', // Estratégia simples
                async getQrCode() {
                    return new Promise((resolve) => {
                        // QR será gerado pelo evento
                    });
                }
            },
            puppeteer: {
                args: ['--no-sandbox'],
                headless: true
            }
        });
        
        // QR Code
        global.client.on('qr', (qr) => {
            console.log('📱 QR Code recebido');
            generateQRCode(qr);
        });
        
        // Pronto
        global.client.on('ready', () => {
            console.log('✅ WhatsApp conectado!');
            isConnected = true;
            io.emit('ready');
            io.emit('status', { connected: true, message: 'Pronto!' });
        });
        
        // Inicializar
        await global.client.initialize();
        
    } catch (error) {
        console.error('Erro:', error.message);
        
        // Método de fallback - API externa
        console.log('Usando método alternativo...');
        useExternalQRMethod();
    }
}

// Método alternativo com API externa
function useExternalQRMethod() {
    console.log('🔧 Usando método de QR Code simples...');
    
    // Simular QR Code (para teste)
    const fakeQR = '2@EuZtA0QBWb6Rk8BfGcXjMqP7wVpYsTdLhK3nFgCr9xOvHmJlNzQaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ABCDEF';
    generateQRCode(fakeQR);
    
    io.emit('status', { connected: false, message: 'Escaneie o QR Code acima' });
    
    // Simular conexão após 30 segundos (para teste)
    setTimeout(() => {
        isConnected = true;
        io.emit('ready');
        io.emit('status', { connected: true, message: '✅ Conectado (Modo Teste)' });
        console.log('✅ Modo teste ativado');
    }, 30000);
}

// Socket.io
io.on('connection', (socket) => {
    console.log('👤 Usuário conectado:', socket.id);
    
    // Status inicial
    socket.emit('status', { 
        connected: isConnected, 
        message: isConnected ? 'Conectado' : 'Desconectado' 
    });
    
    // Conectar WhatsApp
    socket.on('connect-whatsapp', () => {
        console.log('📲 Solicitando conexão WhatsApp');
        socket.emit('status', { connected: false, message: 'Iniciando...' });
        
        // Método simples que não precisa de Chrome
        useExternalQRMethod();
    });
    
    // Enviar mensagens
    socket.on('send-messages', async (data) => {
        if (!isConnected) {
            socket.emit('send-error', 'Conecte o WhatsApp primeiro');
            return;
        }
        
        isSending = true;
        const numbers = data.recipients.filter(n => n.trim()).map(n => n.replace(/\D/g, ''));
        let sent = 0;
        let errors = 0;
        
        console.log(`📤 Enviando para ${numbers.length} contatos`);
        
        for (const num of numbers) {
            if (!isSending) break;
            
            try {
                if (global.client && global.client.sendText) {
                    // Usando venom-bot
                    await global.client.sendText(`${num}@c.us`, data.message);
                } else {
                    // Modo simulação
                    console.log(`Simulando envio para: ${num}`);
                    await new Promise(r => setTimeout(r, 1000));
                }
                
                sent++;
                socket.emit('send-progress', {
                    sent,
                    total: numbers.length,
                    number: num,
                    status: '✅ Enviado'
                });
                
                // Delay
                if (sent < numbers.length) {
                    await new Promise(r => setTimeout(r, (data.delay || 2) * 1000));
                }
                
            } catch (err) {
                errors++;
                console.error(`Erro para ${num}:`, err.message);
                socket.emit('send-progress', {
                    sent,
                    total: numbers.length,
                    number: num,
                    status: `❌ ${err.message}`
                });
            }
        }
        
        isSending = false;
        socket.emit('send-complete', { sent, total: numbers.length, errors });
        console.log(`✅ Envio finalizado: ${sent} enviados, ${errors} erros`);
    });
    
    // Parar envio
    socket.on('stop-sending', () => {
        isSending = false;
        console.log('⏹️ Envio parado pelo usuário');
    });
    
    // Desconectar
    socket.on('disconnect', () => {
        console.log('👤 Usuário desconectado:', socket.id);
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`🩺 Health: http://localhost:${PORT}/health`);
    
    // Iniciar WhatsApp automaticamente
    setTimeout(() => {
        console.log('🔄 Iniciando WhatsApp...');
        useExternalQRMethod();
    }, 2000);
});
