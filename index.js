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

// Configurações para Render
const puppeteerConfig = {
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        headless: 'new',
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser'
    }
};

// Inicialização do WhatsApp
let client = null;
let isConnected = false;
let isSending = false;
let sendQueue = [];

// Função para criar novo cliente
function createClient() {
    try {
        client = new Client({
            authStrategy: new LocalAuth({ clientId: 'whatsapp-bot' }),
            ...puppeteerConfig
        });

        client.on('qr', async (qr) => {
            console.log('QR Code recebido');
            try {
                const qrImage = await qrcode.toDataURL(qr);
                io.emit('qr', qrImage);
            } catch (err) {
                console.log('QR Code gerado (texto)');
                io.emit('qr', qr); // Envia texto se falhar
            }
        });

        client.on('ready', () => {
            console.log('✅ WhatsApp conectado!');
            isConnected = true;
            io.emit('ready');
            io.emit('status', { connected: true, message: 'Conectado!' });
        });

        client.on('authenticated', () => {
            console.log('✅ Autenticado!');
        });

        client.on('auth_failure', (msg) => {
            console.log('❌ Falha na autenticação:', msg);
            io.emit('status', { connected: false, message: 'Falha na autenticação' });
        });

        client.on('disconnected', (reason) => {
            console.log('❌ WhatsApp desconectado:', reason);
            isConnected = false;
            io.emit('disconnected');
            io.emit('status', { connected: false, message: 'Desconectado' });
            
            // Tentar reconectar
            setTimeout(() => {
                console.log('🔄 Tentando reconectar...');
                if (client) {
                    client.destroy();
                }
                createClient();
                client.initialize().catch(err => {
                    console.error('Erro ao reconectar:', err);
                });
            }, 5000);
        });

        client.on('message', msg => {
            console.log('📩 Nova mensagem:', msg.body);
        });

        // Inicializar cliente
        client.initialize().catch(err => {
            console.error('Erro ao inicializar:', err);
            io.emit('status', { connected: false, message: 'Erro: ' + err.message });
        });

    } catch (error) {
        console.error('Erro ao criar cliente:', error);
        io.emit('status', { connected: false, message: 'Erro crítico' });
    }
}

// Socket.io
io.on('connection', (socket) => {
    console.log('🔌 Novo cliente conectado:', socket.id);
    
    // Enviar status atual
    socket.emit('status', { 
        connected: isConnected, 
        message: isConnected ? 'Conectado' : 'Desconectado' 
    });

    // Comandos do cliente
    socket.on('connect-whatsapp', () => {
        console.log('📲 Solicitando conexão WhatsApp');
        if (!client) {
            createClient();
        } else if (!isConnected) {
            client.initialize().catch(err => {
                console.error('Erro ao inicializar:', err);
            });
        }
    });

    socket.on('disconnect-whatsapp', () => {
        console.log('🚫 Solicitando desconexão');
        if (client && isConnected) {
            client.destroy();
            isConnected = false;
            io.emit('status', { connected: false, message: 'Desconectado manualmente' });
        }
    });

    socket.on('check-status', () => {
        socket.emit('status', { 
            connected: isConnected, 
            message: isConnected ? 'Conectado' : 'Desconectado' 
        });
    });

    socket.on('send-messages', async (data) => {
        if (!isConnected || !client) {
            socket.emit('send-error', 'WhatsApp não conectado');
            return;
        }

        if (isSending) {
            socket.emit('send-error', 'Já existe um envio em andamento');
            return;
        }

        isSending = true;
        const recipients = [...data.recipients];
        const total = recipients.length;
        let sent = 0;
        let errors = 0;

        console.log(`📤 Iniciando envio para ${total} contatos`);

        for (const number of recipients) {
            if (!isSending) {
                console.log('⏹️ Envio interrompido');
                break;
            }

            try {
                // Formatar número
                let formattedNumber = number.trim();
                if (!formattedNumber.includes('@c.us')) {
                    formattedNumber = formattedNumber.replace(/\D/g, '');
                    formattedNumber = formattedNumber + '@c.us';
                }

                // Enviar mensagem
                if (data.type === 'image' && data.mediaUrl) {
                    await client.sendMessage(formattedNumber, {
                        image: { url: data.mediaUrl },
                        caption: data.message || ''
                    });
                } else {
                    await client.sendMessage(formattedNumber, data.message || '');
                }

                sent++;
                console.log(`✅ Enviado para ${number}`);
                
                socket.emit('send-progress', {
                    sent,
                    total,
                    number,
                    status: '✅ Enviado'
                });

                // Delay entre mensagens
                if (sent < total) {
                    await new Promise(resolve => setTimeout(resolve, (data.delay || 2) * 1000));
                }

            } catch (error) {
                errors++;
                console.error(`❌ Erro ao enviar para ${number}:`, error.message);
                
                socket.emit('send-progress', {
                    sent,
                    total,
                    number,
                    status: `❌ Erro: ${error.message}`
                });
            }
        }

        isSending = false;
        console.log(`📊 Envio finalizado: ${sent} enviados, ${errors} erros`);
        
        socket.emit('send-complete', {
            sent,
            total,
            errors
        });
    });

    socket.on('stop-sending', () => {
        console.log('⏹️ Parando envio...');
        isSending = false;
    });

    socket.on('disconnect', () => {
        console.log('🔌 Cliente desconectado:', socket.id);
    });
});

// Rota de saúde para Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        whatsapp: isConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`🩺 Health check: http://localhost:${PORT}/health`);
    
    // Inicializar WhatsApp após 2 segundos
    setTimeout(() => {
        console.log('🔄 Iniciando WhatsApp...');
        createClient();
    }, 2000);
});

// Manter ativo
setInterval(() => {
    console.log('💓 Heartbeat - Sistema ativo');
}, 30000);
