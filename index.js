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

// Detectar caminho do Chrome no Render
function getChromePath() {
    // Tentar vários caminhos comuns no Render
    const possiblePaths = [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/chrome',
        '/opt/google/chrome/chrome',
        process.env.CHROMIUM_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH
    ];

    for (const path of possiblePaths) {
        if (path) {
            console.log(`Tentando caminho: ${path}`);
            return path;
        }
    }

    return '/usr/bin/chromium-browser'; // Fallback
}

const chromePath = getChromePath();
console.log(`🎯 Usando Chrome em: ${chromePath}`);

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
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-translate',
            '--disable-features=site-per-process'
        ],
        headless: true,
        executablePath: chromePath,
        ignoreDefaultArgs: ['--disable-extensions']
    }
};

// Variáveis globais
let client = null;
let isConnected = false;
let isSending = false;

// Função para testar se o Chrome está acessível
async function testChrome() {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
        exec(`${chromePath} --version`, (error, stdout) => {
            if (error) {
                console.log(`❌ Chrome não encontrado: ${error.message}`);
                resolve(false);
            } else {
                console.log(`✅ Chrome detectado: ${stdout.trim()}`);
                resolve(true);
            }
        });
    });
}

// Inicializar WhatsApp
async function initWhatsApp() {
    console.log('🔄 Iniciando WhatsApp...');
    
    // Testar Chrome primeiro
    const chromeAvailable = await testChrome();
    if (!chromeAvailable) {
        console.error('❌ Chrome não está disponível');
        io.emit('status', { connected: false, message: 'Erro: Chrome não encontrado' });
        return;
    }
    
    try {
        client = new Client({
            authStrategy: new LocalAuth({ 
                clientId: 'whatsapp-bot-render',
                dataPath: './whatsapp_session'
            }),
            ...puppeteerOptions
        });

        client.on('qr', async (qr) => {
            console.log('📱 QR Code recebido');
            try {
                const qrImage = await qrcode.toDataURL(qr);
                io.emit('qr', qrImage);
            } catch (err) {
                console.log('QR Code (texto):', qr);
                io.emit('qr-text', qr); // Envia como texto
            }
        });

        client.on('ready', () => {
            console.log('✅ WhatsApp conectado!');
            isConnected = true;
            io.emit('ready');
            io.emit('status', { connected: true, message: 'Conectado e pronto!' });
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
            
            // Tentar reconectar
            setTimeout(() => {
                console.log('🔄 Tentando reconectar...');
                initWhatsApp();
            }, 5000);
        });

        client.on('loading_screen', (percent, message) => {
            console.log(`📊 Carregando: ${percent}% - ${message}`);
        });

        // Inicializar com timeout
        const initTimeout = setTimeout(() => {
            console.log('⏰ Timeout na inicialização');
            io.emit('status', { connected: false, message: 'Timeout na inicialização' });
        }, 30000);

        await client.initialize();
        clearTimeout(initTimeout);
        
        console.log('✅ WhatsApp inicializado com sucesso');

    } catch (error) {
        console.error('❌ Erro ao inicializar WhatsApp:', error.message);
        io.emit('status', { connected: false, message: `Erro: ${error.message}` });
        
        // Tentar novamente com configuração alternativa
        if (error.message.includes('Browser') || error.message.includes('Chrome')) {
            console.log('🔄 Tentando configuração alternativa...');
            setTimeout(initWhatsApp, 3000);
        }
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
        console.log('📲 Solicitando conexão WhatsApp');
        if (!client) {
            initWhatsApp();
        } else if (!isConnected) {
            initWhatsApp();
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
            socket.emit('send-error', 'Já existe envio em andamento');
            return;
        }

        isSending = true;
        const recipients = data.recipients.filter(r => r.trim());
        const total = recipients.length;
        let sent = 0;
        let errors = 0;

        console.log(`📤 Iniciando envio para ${total} contatos`);

        for (const number of recipients) {
            if (!isSending) {
                console.log('⏹️ Envio interrompido pelo usuário');
                break;
            }

            try {
                // Formatar número
                let phone = number.trim().replace(/\D/g, '');
                if (phone.length < 10) {
                    console.log(`⚠️ Número inválido: ${number}`);
                    errors++;
                    continue;
                }
                
                if (!phone.includes('@c.us')) {
                    phone = phone + '@c.us';
                }

                // Verificar se o número existe
                const contact = await client.getNumberId(phone);
                if (!contact) {
                    console.log(`⚠️ Número não existe no WhatsApp: ${phone}`);
                    errors++;
                    socket.emit('send-progress', {
                        sent,
                        total,
                        number,
                        status: '⚠️ Número não encontrado'
                    });
                    continue;
                }

                // Enviar mensagem
                if (data.type === 'image' && data.mediaUrl) {
                    await client.sendMessage(contact._serialized, {
                        image: { url: data.mediaUrl },
                        caption: data.message || ''
                    });
                } else {
                    await client.sendMessage(contact._serialized, data.message || '');
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
                if (sent + errors < total) {
                    await new Promise(resolve => setTimeout(resolve, (data.delay || 2) * 1000));
                }

            } catch (error) {
                errors++;
                console.error(`❌ Erro ao enviar para ${number}:`, error.message);
                
                socket.emit('send-progress', {
                    sent,
                    total,
                    number,
                    status: `❌ Erro: ${error.message.substring(0, 50)}`
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

// Rota de saúde
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        whatsapp: isConnected ? 'connected' : 'disconnected',
        time: new Date().toISOString(),
        chrome: chromePath
    });
});

// Rota para debug
app.get('/debug', (req, res) => {
    const { exec } = require('child_process');
    exec('which chromium-browser chromium google-chrome chrome', (error, stdout) => {
        res.json({
            chromePath,
            available: stdout,
            connected: isConnected,
            session: './whatsapp_session'
        });
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`🩺 Health check: http://localhost:${PORT}/health`);
    console.log(`🔧 Debug: http://localhost:${PORT}/debug`);
    
    // Iniciar WhatsApp após 2 segundos
    setTimeout(initWhatsApp, 2000);
});

// Manter ativo
setInterval(() => {
    console.log('💓 Sistema ativo');
    if (client && isConnected) {
        console.log('📱 WhatsApp conectado');
    }
}, 60000);
