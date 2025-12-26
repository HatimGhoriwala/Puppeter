const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Health check endpoint
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
  
  // Validate inputs
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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    let capturedToken = null;
    
    // Intercept network requests
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
    
    console.log('📍 Navigating to login page...');
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 90000 
    });
    
    // Wait for login form
    console.log('⏳ Waiting for login form...');
    await page.waitForSelector('input[type="email"], input[name="Input.Email"], input[placeholder*="email"]', { 
      timeout: 30000 
    });
    
    // Fill username
    console.log('✍️ Entering username...');
    const emailSelector = 'input[type="email"], input[name="Input.Email"], input[placeholder*="email"]';
    await page.click(emailSelector);
    await page.type(emailSelector, username, { delay: 50 });
    
    // Fill password
    console.log('🔐 Entering password...');
    const passwordSelector = 'input[type="password"], input[name="Input.Password"]';
    await page.waitForSelector(passwordSelector, { timeout: 10000 });
    await page.click(passwordSelector);
    await page.type(passwordSelector, password, { delay: 50 });
    
    // Click login button
    console.log('🔘 Clicking login button...');
    await page.click('button[type="submit"], button:has-text("Log in")');
    
    // Wait for navigation
    console.log('⏳ Waiting for authentication...');
    await page.waitForNavigation({ 
      waitUntil: 'networkidle2', 
      timeout: 90000 
    });
    
    // Wait for API calls with tokens
    await page.waitForTimeout(8000);
    
    // Extract from storage if not captured
    if (!capturedToken) {
      console.log('🔍 Extracting from storage...');
      
      capturedToken = await page.evaluate(() => {
        // Check localStorage
        for (const key of Object.keys(localStorage)) {
          const value = localStorage.getItem(key);
          if (!value) continue;
          
          if (value.includes('eyJ') || key.toLowerCase().includes('token')) {
            try {
              const parsed = JSON.parse(value);
              if (parsed.access_token) return parsed.access_token;
              if (parsed.id_token) return parsed.id_token;
              if (parsed.token) return parsed.token;
            } catch (e) {
              if (value.startsWith('eyJ')) return value;
            }
          }
        }
        
        // Check sessionStorage
        for (const key of Object.keys(sessionStorage)) {
          const value = sessionStorage.getItem(key);
          if (!value) continue;
          
          if (value.includes('eyJ') || key.toLowerCase().includes('token')) {
            try {
              const parsed = JSON.parse(value);
              if (parsed.access_token) return parsed.access_token;
              if (parsed.id_token) return parsed.id_token;
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
      throw new Error('Failed to capture token from network or storage');
    }
    
    console.log('✅ Token extraction successful!');
    
    // Return token with metadata
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
      error: error.message,
      details: error.stack
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Token service running on port ${PORT}`);
});
