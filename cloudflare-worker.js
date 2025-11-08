/**
 * Cloudflare Worker to proxy JSONBin.io requests
 * 
 * Deploy this to Cloudflare Workers to solve CORS issues
 * 
 * Setup:
 * 1. Go to https://dash.cloudflare.com
 * 2. Workers → Create a Service
 * 3. Copy this code into the worker
 * 4. Add environment variables:
 *    - JSONBIN_API_KEY: Your JSONBin.io Master Key
 *    - JSONBIN_BIN_ID: Your Bin ID
 * 5. Deploy
 * 6. Update script.js to use worker URL instead of api.jsonbin.io
 */

const JSONBIN_API_KEY = '$2a$10$aykcTuMUyEz67pg05agzx.dqAWKAiMzRwI6EZZPjKbabxR77epyWC';
const JSONBIN_BIN_ID = '690cab8c43b1c97be99cd080';
const JSONBIN_BASE_URL = 'https://api.jsonbin.io/v3';

// Allowed origins (add your GitHub Pages domain)
const ALLOWED_ORIGINS = [
  'https://xadamshaw.github.io',
  'http://localhost:8000',
  'http://localhost:3000',
  'http://127.0.0.1:8000'
];

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleCORS(request);
  }

  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  // Check origin
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Origin not allowed', { status: 403 });
  }

  try {
    // Parse request
    const method = request.method;
    const path = url.pathname;

    // Determine JSONBin.io endpoint
    let jsonbinUrl;
    if (path === '/latest' || path === '/') {
      jsonbinUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}/latest`;
    } else if (path === '/update') {
      jsonbinUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}`;
    } else {
      return new Response('Invalid path', { status: 404 });
    }

    // Forward request to JSONBin.io
    const headers = {
      'X-Master-Key': JSONBIN_API_KEY,
      'Content-Type': 'application/json'
    };

    let body = null;
    if (method === 'PUT' || method === 'POST') {
      body = await request.text();
    }

    const response = await fetch(jsonbinUrl, {
      method: method,
      headers: headers,
      body: body
    });

    // Get response data
    const data = await response.text();
    const status = response.status;

    // Return with CORS headers
    return new Response(data, {
      status: status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin
      }
    });
  }
}

function handleCORS(request) {
  const origin = request.headers.get('Origin');
  
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Origin not allowed', { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

