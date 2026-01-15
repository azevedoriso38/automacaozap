#!/bin/bash
echo "🚀 Iniciando instalação do Chrome para Render..."

# Atualizar sistema
apt-get update
apt-get install -y wget gnupg unzip curl

# Instalar Node.js 18 se necessário
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# Baixar e instalar Chrome
echo "⬇️ Baixando Chrome..."
wget -q -O chrome.deb "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
apt-get install -y ./chrome.deb
rm chrome.deb

# Verificar instalação
echo "✅ Chrome instalado:"
google-chrome --version

# Instalar dependências do Puppeteer
echo "📦 Instalando dependências..."
apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils

# Instalar dependências npm
echo "📦 Instalando dependências Node.js..."
npm install

echo "🎉 Instalação completa!"
