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
    version: '3.0.1 - Fixed'
  });
});

// Helper function for waiting (compatible with all Puppeteer versions)
async function wait(page, ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
          console.log('✅ Token captured from network request');
        }
      }
      request.continue();
    });
    
    console.log('📍 Step 1: Navigating to Epicor home page...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    
    console.log('Current URL:', page.url());
    
    // STEP 1: Click the initial "Log in" button
    console.log('🔘 Step 2: Clicking initial Log in button...');
    await page.waitForSelector('#loginButton', { timeout: 30000 });
    await page.click('#loginButton');
    
    // Wait for navigation to Identity Provider
    console.log('⏳ Waiting for redirect to Identity Provider...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log('Current URL after first click:', page.url());
    
    // STEP 2: Enter email
    console.log('✍️ Step 3: Entering email...');
    await page.waitForSelector('#Input_Email', { timeout: 30000 });
    await page.type('#Input_Email', username, { delay: 100 });
    
    // STEP 3: Click "Log In" to proceed to password page
    console.log('🔘 Step 4: Clicking Log In to proceed to password...');
    await page.waitForSelector('button[type="submit"].btn.btn-primary', { timeout: 10000 });
    await page.click('button[type="submit"].btn.btn-primary');
    
    // Wait for password page
    console.log('⏳ Waiting for password page...');
    await wait(page, 3000);
    
    // STEP 4: Enter password
    console.log('🔐 Step 5: Entering password...');
    await page.waitForSelector('#Input_Password', { timeout: 30000 });
    await page.type('#Input_Password', password, { delay: 100 });
    
    // STEP 5: Click final "Log In" button
    console.log('🔘 Step 6: Clicking final Log In button...');
    await page.waitForSelector('button[type="submit"].btn.btn-primary', { timeout: 10000 });
    await page.click('button[type="submit"].btn.btn-primary');
    
    // Wait for authentication and redirect
    console.log('⏳ Step 7: Waiting for authentication...');
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 });
    } catch (e) {
      console.log('Navigation timeout, checking if logged in...');
    }
    
    // Give time for tokens to be stored
    console.log('⏳ Waiting for token to be stored...');
    await wait(page, 10000);
    
    console.log('Final URL:', page.url());
    
    // Extract token from storage if not captured
    if (!capturedToken) {
      console.log('🔍 Step 8: Extracting token from storage...');
      
      capturedToken = await page.evaluate(() => {
        const findJWT = (value) => {
          if (!value) return null;
          if (typeof value === 'string' && value.startsWith('eyJ')) return value;
          
          try {
            const parsed = JSON.parse(value);
            if (parsed.access_token) return parsed.access_token;
            if (parsed.id_token) return parsed.id_token;
            if (parsed.token) return parsed.token;
          } catch (e) {}
          
          return null;
        };
        
        for (const key of Object.keys(localStorage)) {
          const token = findJWT(localStorage.getItem(key));
          if (token) {
            console.log('Found in localStorage:', key);
            return token;
          }
        }
        
        for (const key of Object.keys(sessionStorage)) {
          const token = findJWT(sessionStorage.getItem(key));
          if (token) {
            console.log('Found in sessionStorage:', key);
            return token;
          }
        }
        
        return null;
      });
    }
    
    await browser.close();
    
    if (!capturedToken) {
      throw new Error('Token not found after login. Please verify credentials.');
    }
    
    console.log('✅ SUCCESS! Token extracted');
    
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
      } catch (e) {}
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Epicor Token Service running on port ${PORT}`);
});
