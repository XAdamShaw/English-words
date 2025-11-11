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

  // Check origin (only if Origin header exists, allow curl requests)
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Origin not allowed', { 
      status: 403,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }

  try {
    // Parse request
    const method = request.method;
    const path = url.pathname;
    
    // Debug: log the request
    console.log(`[Worker] ${method} ${path}`);

    // Determine JSONBin.io endpoint
    let jsonbinUrl;
    let response;
    
    if (path === '/latest' || path === '/') {
      // GET /latest: Fetch all data
      jsonbinUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}/latest`;
      
      const headers = {
        'X-Master-Key': JSONBIN_API_KEY,
        'Content-Type': 'application/json'
      };
      
      response = await fetch(jsonbinUrl, {
        method: 'GET',
        headers: headers
      });
      
    } else if (path === '/update') {
      // PUT /update: Update bin (supports both full bin update and single record update)
      // If request body is { key: "...", record: {...} }, treat as single record update
      // Otherwise, treat as full bin update
      
      try {
        const requestBody = await request.json();
        
        // Check if this is a single record update (has 'key' and 'record' fields)
        if (requestBody && typeof requestBody === 'object' && 'key' in requestBody && 'record' in requestBody && Object.keys(requestBody).length === 2) {
          // Single record update
          const { key, record } = requestBody;
          
          console.log(`[Worker] Processing single record update via /update: key=${key}`);
          
          // First, fetch current bin data
          const getUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}/latest`;
          const getResponse = await fetch(getUrl, {
            method: 'GET',
            headers: {
              'X-Master-Key': JSONBIN_API_KEY,
              'Content-Type': 'application/json'
            }
          });
          
          if (!getResponse.ok) {
            return new Response(JSON.stringify({ 
              error: 'Failed to fetch current data',
              message: `GET request failed: ${getResponse.status} ${getResponse.statusText}`
            }), {
              status: getResponse.status,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': origin
              }
            });
          }
          
          const getData = await getResponse.json();
          const allData = getData.record || getData || {};
          
          // Update only the specified key
          allData[key] = record;
          
          // Update the entire bin (JSONBin.io doesn't support partial updates)
          const putUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}`;
          const putResponse = await fetch(putUrl, {
            method: 'PUT',
            headers: {
              'X-Master-Key': JSONBIN_API_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(allData)
          });
          
          if (!putResponse.ok) {
            return new Response(JSON.stringify({ 
              error: 'Failed to update data',
              message: `PUT request failed: ${putResponse.status} ${putResponse.statusText}`
            }), {
              status: putResponse.status,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': origin
              }
            });
          }
          
          // Return only the updated record
          const responseData = {
            key: key,
            record: record
          };
          
          return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': origin,
              'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
              'Access-Control-Max-Age': '86400'
            }
          });
        } else {
          // Full bin update (legacy, for backward compatibility)
          console.log(`[Worker] Processing full bin update via /update`);
          
          jsonbinUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}`;
          
          const headers = {
            'X-Master-Key': JSONBIN_API_KEY,
            'Content-Type': 'application/json'
          };
          
          const body = JSON.stringify(requestBody);
          
          response = await fetch(jsonbinUrl, {
            method: 'PUT',
            headers: headers,
            body: body
          });
        }
      } catch (error) {
        // If JSON parsing fails, treat as raw text (legacy behavior)
        console.log(`[Worker] JSON parse failed, treating as raw text`);
        
        const body = await request.text();
        jsonbinUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}`;
        
        const headers = {
          'X-Master-Key': JSONBIN_API_KEY,
          'Content-Type': 'application/json'
        };
        
        response = await fetch(jsonbinUrl, {
          method: 'PUT',
          headers: headers,
          body: body
        });
      }
      
    } else if (path === '/update-single') {
      // PUT /update-single: Update single record only (custom endpoint in Worker)
      // This is NOT a jsonbin.io native endpoint, but a custom endpoint in Cloudflare Worker
      // Request body: { key: "ten1000Words-1", record: { key: "...", stars: 2, ... } }
      // Response: { key: "...", record: { ... } } (only the updated record)
      // 
      // How it works:
      // 1. GET /b/{binId}/latest - Fetch entire bin from jsonbin.io
      // 2. Update the single record in the bin
      // 3. PUT /b/{binId} - Update entire bin back to jsonbin.io
      // 4. Return only the updated record to client
      
      console.log(`[Worker] Processing /update-single request`);
      
      try {
        const requestBody = await request.json();
        const { key, record } = requestBody;
        
        if (!key || !record) {
          return new Response(JSON.stringify({ 
            error: 'Missing key or record in request body',
            message: 'Request body must contain { key: string, record: object }'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': origin
            }
          });
        }
        
        // First, fetch current bin data
        const getUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}/latest`;
        const getResponse = await fetch(getUrl, {
          method: 'GET',
          headers: {
            'X-Master-Key': JSONBIN_API_KEY,
            'Content-Type': 'application/json'
          }
        });
        
        if (!getResponse.ok) {
          return new Response(JSON.stringify({ 
            error: 'Failed to fetch current data',
            message: `GET request failed: ${getResponse.status} ${getResponse.statusText}`
          }), {
            status: getResponse.status,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': origin
            }
          });
        }
        
        const getData = await getResponse.json();
        const allData = getData.record || getData || {};
        
        // Update only the specified key
        allData[key] = record;
        
        // Update the entire bin (JSONBin.io doesn't support partial updates)
        const putUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}`;
        const putResponse = await fetch(putUrl, {
          method: 'PUT',
          headers: {
            'X-Master-Key': JSONBIN_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(allData)
        });
        
        if (!putResponse.ok) {
          return new Response(JSON.stringify({ 
            error: 'Failed to update data',
            message: `PUT request failed: ${putResponse.status} ${putResponse.statusText}`
          }), {
            status: putResponse.status,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': origin
            }
          });
        }
        
        // Return only the updated record
        const responseData = {
          key: key,
          record: record
        };
        
        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
          }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: error.message,
          message: 'Failed to process update-single request'
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin
          }
        });
      }
      
    } else {
      return new Response(JSON.stringify({ 
        error: 'Invalid path',
        message: `Path "${path}" is not supported. Use /latest, /update, or /update-single`
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin
        }
      });
    }

    // Get response data for /latest and /update endpoints
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

