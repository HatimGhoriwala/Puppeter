const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'running', 
    service: 'Epicor Token Extractor',
    version: '1.0.0'
  });
});

// Token extraction endpoint
app.post('/get-token', async (req, res) => {
  const { username, password, url } = req.body;
  
  if (!username || !password || !url) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields: username, password, url' 
    });
  }
  
  let browser;
  
  try {
    console.log('🚀 Launching browser...');
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--single-process',
        '--no-zygote'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    let capturedToken = null;
    
    // Capture token from network requests
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const headers = request.headers();
      if (headers['authorization'] && headers['authorization'].startsWith('Bearer ')) {
        if (!capturedToken) {
          capturedToken = headers['authorization'].replace('Bearer ', '');
          console.log('✅ Token captured from network');
        }
      }
      request.continue();
    });
    
    console.log('📍 Navigating to:', url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    
    console.log('⏳ Waiting for login form...');
    await page.waitForSelector('input[type="email"], input[name="Input.Email"]', { timeout: 30000 });
    
    console.log('✍️ Entering credentials...');
    await page.type('input[type="email"], input[name="Input.Email"]', username, { delay: 50 });
    await page.type('input[type="password"], input[name="Input.Password"]', password, { delay: 50 });
    
    console.log('🔘 Submitting login...');
    await page.click('button[type="submit"]');
    
    console.log('⏳ Waiting for authentication...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForTimeout(8000);
    
    // Extract from storage if not captured
    if (!capturedToken) {
      console.log('🔍 Extracting from storage...');
      capturedToken = await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          const value = localStorage.getItem(key);
          if (value && value.includes('eyJ')) {
            try {
              const parsed = JSON.parse(value);
              if (parsed.access_token) return parsed.access_token;
              if (parsed.id_token) return parsed.id_token;
            } catch (e) {
              if (value.startsWith('eyJ')) return value;
            }
          }
        }
        for (const key of Object.keys(sessionStorage)) {
          const value = sessionStorage.getItem(key);
          if (value && value.includes('eyJ')) {
            try {
              const parsed = JSON.parse(value);
              if (parsed.access_token) return parsed.access_token;
            } catch (e) {
              if (value.startsWith('eyJ')) return value;
            }
          }
        }
        return null;
      });
    }
    
    await browser.close();
    
    if (!capturedToken) {
      throw new Error('Token not found. Please verify credentials.');
    }
    
    console.log('✅ Success!');
    
    res.json({ 
      success: true, 
      token: capturedToken,
      authorizationHeader: `Bearer ${capturedToken}`,
      expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
      capturedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (browser) await browser.close();
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
