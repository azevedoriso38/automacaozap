const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configuração do Express
app.use(express.json());
app.use(express.static(__dirname));

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Configuração do Puppeteer para Render
const puppeteerOptions = {
    puppeteer: {
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
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium'
    }
};

// Variáveis globais
let client = null;
let isConnected = false;
let isSending = false;

// Inicializar WhatsApp
function initWhatsApp() {
    console.log('🔄 Iniciando WhatsApp...');
    
    try {
        client = new Client({
            authStrategy: new LocalAuth({ clientId: 'whatsapp-bot-render' }),
            ...puppeteerOptions
        });

        client.on('qr', async (qr) => {
            console.log('📱 QR Code recebido');
            try {
                const qrImage = await qrcode.toDataURL(qr);
                io.emit('qr', qrImage);
            } catch (err) {
                console.log('QR Code (texto):', qr);
                io.emit('qr', qr);
            }
        });

        client.on('ready', () => {
            console.log('✅ WhatsApp conectado!');
            isConnected = true;
            io.emit('ready');
            io.emit('status', { connected: true, message: 'Conectado!' });
        });

        client.on('authenticated', () => {
            console.log('🔐 Autenticado com sucesso');
        });

        client.on('auth_failure', (msg) => {
            console.error('❌ Falha na autenticação:', msg);
            io.emit('status', { connected: false, message: 'Falha na autenticação' });
        });

        client.on('disconnected', (reason) => {
            console.log('❌ Desconectado:', reason);
            isConnected = false;
            io.emit('disconnected');
            io.emit('status', { connected: false, message: 'Desconectado' });
            
            // Reconectar após 3 segundos
            setTimeout(() => {
                if (client) {
                    client.destroy();
                }
                initWhatsApp();
                if (client) {
                    client.initialize().catch(err => {
                        console.error('Erro ao reconectar:', err);
                    });
                }
            }, 3000);
        });

        client.on('loading_screen', (percent, message) => {
            console.log(`📊 Carregando: ${percent}% - ${message}`);
        });

        // Inicializar
        client.initialize().catch(err => {
            console.error('❌ Erro ao inicializar:', err.message);
        });

    } catch (error) {
        console.error('❌ Erro crítico:', error);
    }
}

// Socket.io
io.on('connection', (socket) => {
    console.log('🔌 Cliente conectado:', socket.id);
    
    // Status atual
    socket.emit('status', { 
        connected: isConnected, 
        message: isConnected ? 'Conectado' : 'Desconectado' 
    });

    // Comandos
    socket.on('connect-whatsapp', () => {
        console.log('📲 Solicitando conexão');
        if (!client) {
            initWhatsApp();
        } else if (!isConnected) {
            client.initialize().catch(console.error);
        }
    });

    socket.on('disconnect-whatsapp', () => {
        console.log('🚫 Solicitando desconexão');
        if (client && isConnected) {
            client.destroy();
            isConnected = false;
            io.emit('status', { connected: false, message: 'Desconectado' });
        }
    });

    socket.on('check-status', () => {
        socket.emit('status', { 
            connected: isConnected, 
            message: isConnected ? 'Conectado' : 'Desconectado' 
        });
    });

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
        const recipients = data.recipients.filter(r => r.trim());
        const total = recipients.length;
        let sent = 0;

        console.log(`📤 Enviando para ${total} contatos`);

        for (const number of recipients) {
            if (!isSending) break;

            try {
                // Formatar número
                let phone = number.trim().replace(/\D/g, '');
                if (!phone.includes('@c.us')) {
                    phone = phone + '@c.us';
                }

                // Enviar
                if (data.type === 'image' && data.mediaUrl) {
                    await client.sendMessage(phone, {
                        image: { url: data.mediaUrl },
                        caption: data.message || ''
                    });
                } else {
                    await client.sendMessage(phone, data.message || '');
                }

                sent++;
                socket.emit('send-progress', {
                    sent,
                    total,
                    number,
                    status: '✅ Enviado'
                });

                // Delay
                if (sent < total) {
                    await new Promise(r => setTimeout(r, (data.delay || 2) * 1000));
                }

            } catch (error) {
                console.error(`Erro para ${number}:`, error.message);
                socket.emit('send-progress', {
                    sent,
                    total,
                    number,
                    status: `❌ ${error.message}`
                });
            }
        }

        isSending = false;
        socket.emit('send-complete');
        console.log(`✅ Envio finalizado: ${sent}/${total}`);
    });

    socket.on('stop-sending', () => {
        isSending = false;
    });

    socket.on('disconnect', () => {
        console.log('🔌 Cliente desconectado:', socket.id);
    });
});

// Rota health
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
    console.log(`🚀 Servidor rodando: http://localhost:${PORT}`);
    console.log(`🩺 Health: http://localhost:${PORT}/health`);
    
    // Iniciar WhatsApp
    setTimeout(initWhatsApp, 1000);
});
