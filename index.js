const express = require('express');
const puppeteer = require('puppeteer-core');
const cors = require('cors');
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

// Function to find Chrome executable
function findChrome() {
  const platform = os.platform();
  
  const chromePaths = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe'
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    ]
  };
  
  const paths = chromePaths[platform] || [];
  
  for (const path of paths) {
    try {
      if (fs.existsSync(path)) {
        console.log(`✅ Found Chrome at: ${path}`);
        return path;
      }
    } catch (e) {
      // Continue searching
    }
  }
  
  // Try to find using which/where command
  try {
    if (platform === 'win32') {
      const result = execSync('where chrome', { encoding: 'utf8' });
      const chromePath = result.split('\n')[0].trim();
      if (chromePath && fs.existsSync(chromePath)) {
        console.log(`✅ Found Chrome via 'where': ${chromePath}`);
        return chromePath;
      }
    } else {
      const result = execSync('which google-chrome || which chromium', { encoding: 'utf8' });
      const chromePath = result.trim();
      if (chromePath && fs.existsSync(chromePath)) {
        console.log(`✅ Found Chrome via 'which': ${chromePath}`);
        return chromePath;
      }
    }
  } catch (e) {
    console.log('Could not find Chrome using system commands');
  }
  
  throw new Error('Chrome/Chromium not found. Please install Google Chrome or Chromium browser.');
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running', 
    service: 'Epicor Token Extractor (puppeteer-core)',
    version: '1.0.0',
    platform: os.platform()
  });
});

// Check if Chrome is available
app.get('/check-chrome', (req, res) => {
  try {
    const chromePath = findChrome();
    res.json({ 
      success: true, 
      chromePath,
      message: 'Chrome found and ready'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'Please install Google Chrome or Chromium browser'
    });
  }
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
    
    // Find Chrome executable
    const executablePath = findChrome();
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath: executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Hide automation flags
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });
    
    let capturedToken = null;
    
    // Intercept network requests to capture token
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const headers = request.headers();
      if (headers['authorization'] && headers['authorization'].startsWith('Bearer ')) {
        if (!capturedToken) {
          capturedToken = headers['authorization'].replace('Bearer ', '');
          console.log('✅ Token captured from network request');
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
    await page.keyboard.type(username, { delay: 50 });
    
    // Fill password
    console.log('🔐 Entering password...');
    const passwordSelector = 'input[type="password"], input[name="Input.Password"]';
    await page.waitForSelector(passwordSelector, { timeout: 10000 });
    await page.click(passwordSelector);
    await page.keyboard.type(password, { delay: 50 });
    
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
    console.log('⏳ Waiting for token...');
    await page.waitForTimeout(8000);
    
    // Extract from storage if not captured from network
    if (!capturedToken) {
      console.log('🔍 Extracting token from storage...');
      
      capturedToken = await page.evaluate(() => {
        // Helper function to extract token from value
        const extractToken = (value) => {
          if (!value) return null;
          
          // Check if it's a JWT (starts with eyJ)
          if (value.startsWith('eyJ')) return value;
          
          // Try to parse as JSON
          try {
            const parsed = JSON.parse(value);
            if (parsed.access_token) return parsed.access_token;
            if (parsed.id_token) return parsed.id_token;
            if (parsed.token) return parsed.token;
          } catch (e) {
            // Not JSON
          }
          
          return null;
        };
        
        // Check localStorage
        for (const key of Object.keys(localStorage)) {
          const value = localStorage.getItem(key);
          const token = extractToken(value);
          if (token) {
            console.log('Found in localStorage key:', key);
            return token;
          }
        }
        
        // Check sessionStorage
        for (const key of Object.keys(sessionStorage)) {
          const value = sessionStorage.getItem(key);
          const token = extractToken(value);
          if (token) {
            console.log('Found in sessionStorage key:', key);
            return token;
          }
        }
        
        return null;
      });
    }
    
    await browser.close();
    
    if (!capturedToken) {
      throw new Error('Failed to capture token from network or storage. Please verify login credentials.');
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
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    
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
  console.log(`📍 Test at: http://localhost:${PORT}`);
  
  // Check if Chrome is available on startup
  try {
    findChrome();
  } catch (error) {
    console.error('⚠️ WARNING:', error.message);
  }
});
