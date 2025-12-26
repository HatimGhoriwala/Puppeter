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
    version: '2.0.0'
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
          console.log('✅ Token captured from network request');
        }
      }
      request.continue();
    });
    
    console.log('📍 Step 1: Navigating to Epicor...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    
    // STEP 1: Click the "Log in" button on the first page
    console.log('🔘 Step 2: Clicking initial Log in button...');
    try {
      await page.waitForSelector('button:has-text("Log in"), button[type="submit"]', { timeout: 10000 });
      await page.click('button:has-text("Log in"), button[type="submit"]');
      console.log('✅ Clicked Log in button, waiting for redirect...');
      
      // Wait for navigation to Identity Provider
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log('⚠️ No initial login button found, might already be on IdP page');
    }
    
    // STEP 2: Now we should be on the Identity Provider page
    console.log('📍 Step 3: Waiting for Identity Provider login form...');
    
    // Wait for email input field (on login.epicor.com)
    await page.waitForSelector('input[type="email"], input[placeholder*="mail"], input#Input_Email', { 
      timeout: 30000 
    });
    
    console.log('✍️ Step 4: Entering email...');
    const emailInput = await page.$('input[type="email"], input[placeholder*="mail"], input#Input_Email');
    await emailInput.click();
    await emailInput.type(username, { delay: 100 });
    
    // Check if password field is on same page or need to click next
    console.log('🔍 Checking for password field...');
    const passwordExists = await page.$('input[type="password"]');
    
    if (!passwordExists) {
      // Need to click "Next" or "Continue" button
      console.log('🔘 Clicking Next button...');
      await page.click('button[type="submit"], button:has-text("Next"), button:has-text("Continue")');
      await page.waitForTimeout(2000);
    }
    
    // Wait for password field
    console.log('🔐 Step 5: Entering password...');
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    const passwordInput = await page.$('input[type="password"]');
    await passwordInput.click();
    await passwordInput.type(password, { delay: 100 });
    
    // Click final login/submit button
    console.log('🔘 Step 6: Submitting credentials...');
    await page.click('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');
    
    // Wait for successful login and redirect back to Epicor
    console.log('⏳ Step 7: Waiting for authentication...');
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 });
    } catch (e) {
      console.log('Navigation timeout, checking if we are logged in...');
    }
    
    // Give extra time for tokens to appear
    console.log('⏳ Waiting for token to appear...');
    await page.waitForTimeout(10000);
    
    // Extract token from storage if not captured from network
    if (!capturedToken) {
      console.log('🔍 Step 8: Extracting token from storage...');
      
      capturedToken = await page.evaluate(() => {
        // Helper to extract JWT from any value
        const findJWT = (value) => {
          if (!value) return null;
          
          // Direct JWT
          if (typeof value === 'string' && value.startsWith('eyJ')) {
            return value;
          }
          
          // Try parsing as JSON
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
        
        // Search localStorage
        for (const key of Object.keys(localStorage)) {
          const value = localStorage.getItem(key);
          const token = findJWT(value);
          if (token) {
            console.log('Found token in localStorage:', key);
            return token;
          }
        }
        
        // Search sessionStorage
        for (const key of Object.keys(sessionStorage)) {
          const value = sessionStorage.getItem(key);
          const token = findJWT(value);
          if (token) {
            console.log('Found token in sessionStorage:', key);
            return token;
          }
        }
        
        return null;
      });
    }
    
    await browser.close();
    
    if (!capturedToken) {
      throw new Error('Failed to capture token. Please verify credentials and try again.');
    }
    
    console.log('✅ SUCCESS! Token obtained');
    
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
      hint: 'Make sure credentials are correct and Epicor is accessible'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Token service running on port ${PORT}`);
});
