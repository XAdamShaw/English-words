// ==================== Cloudflare Worker Configuration ====================
// 
// ⚠️ 重要：请将下面的 URL 替换为你的 Cloudflare Worker URL
// 
// 如何获取 Worker URL：
// 1. 按照 CLOUDFLARE_WORKER_SETUP_GUIDE.md 文档创建 Worker
// 2. 部署成功后会显示类似：https://jsonbin-proxy.YOUR_USERNAME.workers.dev
// 3. 复制该 URL 并替换下面的配置
//
// const CLOUDFLARE_WORKER_URL = 'https://your-worker.workers.dev'; // ⚠️ 替换为你的 Worker URL
const CLOUDFLARE_WORKER_URL = 'https://jsonbin-proxy.adamshawsolar.workers.dev'; // ⚠️ 替换为你的 Worker URL

// JSONBin.io 配置（Worker 内部使用，无需修改）
const JSONBIN_API额q_KEY = '$2a$10$aykcTuMUyEz67pg05agzx.dqAWKAiMzRwI6EZZPjKbabxR77epyWC';
const JSONBIN_BIN_ID = '690cab8c43b1c97be99cd080';

// In-memory cache for sync data
let syncCache = {}; // key -> { stars, lastViewedRow, filterLevel, sortByStars, syncStatus }
let syncCacheModified = {}; // key -> boolean (track if data is modified)

// ==================== Request Queue Manager ====================
/**
 * Request Queue Manager to handle rate limiting and prevent 429 errors
 */
class RequestQueueManager {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.requestCount = 0;
    this.requestTimestamps = [];
    
    // Configuration - Stricter limits to avoid 429
    this.maxConcurrent = 2;        // Reduced from 3
    this.minInterval = 150;        // Reduced from 200ms
    this.retryBackoff = [3000, 6000]; // 3-6 seconds random backoff on 429
    this.maxRequestsPerMinute = 5; // Reduced from 10
    this.maxRetries = 2;           // Maximum retry attempts
    this.timeout = 5000;           // 5 second timeout
    this.currentConcurrent = 0;
  }
  
  /**
   * Add request to queue
   * @param {Function} requestFn - Async function that performs the request
   * @param {Object} options - Request options
   * @returns {Promise} Promise that resolves when request completes
   */
  enqueue(requestFn, options = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        requestFn,
        options,
        resolve,
        reject,
        retryCount: 0
      });
      
      if (!this.processing) {
        this.processQueue();
      }
    });
  }
  
  /**
   * Process queued requests with rate limiting
   */
  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    
    while (this.queue.length > 0) {
      // Check if we've exceeded rate limit
      if (!this.canMakeRequest()) {
        const waitTime = this.getWaitTime();
        console.log(`⏳ 请求限流中，等待 ${waitTime}ms...`);
        await this.sleep(waitTime);
        continue;
      }
      
      // Process up to maxConcurrent requests in parallel
      const batch = [];
      while (
        this.queue.length > 0 && 
        this.currentConcurrent < this.maxConcurrent &&
        this.canMakeRequest()
      ) {
        const item = this.queue.shift();
        this.currentConcurrent++;
        batch.push(this.executeRequest(item));
        
        // Wait minimum interval before next request
        if (this.queue.length > 0) {
          await this.sleep(this.minInterval);
        }
      }
      
      // Wait for batch to complete
      if (batch.length > 0) {
        await Promise.all(batch);
      }
      
      // If no more requests can be made now, wait
      if (this.queue.length > 0 && !this.canMakeRequest()) {
        const waitTime = this.getWaitTime();
        await this.sleep(waitTime);
      }
    }
    
    this.processing = false;
  }
  
  /**
   * Execute a single request with retry logic and timeout
   */
  async executeRequest(item) {
    try {
      // Add timeout to request
      const result = await Promise.race([
        item.requestFn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), this.timeout)
        )
      ]);
      
      this.recordRequest();
      this.currentConcurrent--;
      item.resolve(result);
    } catch (error) {
      this.currentConcurrent--;
      
      // Log error details
      console.warn(`⚠️ 请求失败: ${error.message || error}`);
      
      // Handle 429 Too Many Requests
      if (error.status === 429 || error.message?.includes('429')) {
        if (item.retryCount < this.maxRetries) {
          console.warn(`⚠️ 429错误，第 ${item.retryCount + 1} 次重试（最多${this.maxRetries}次）...`);
          
          // Random backoff between 3-6 seconds
          const backoff = this.retryBackoff[0] + 
            Math.random() * (this.retryBackoff[1] - this.retryBackoff[0]);
          
          console.log(`⏳ 退避等待 ${(backoff/1000).toFixed(1)} 秒...`);
          await this.sleep(backoff);
          
          // Re-queue the request
          item.retryCount++;
          this.queue.unshift(item);
        } else {
          console.error(`❌ 429错误，已重试${this.maxRetries}次，放弃请求`);
          item.reject(error);
        }
      } else if (error.message === 'Request timeout') {
        // Handle timeout
        if (item.retryCount < this.maxRetries) {
          console.warn(`⚠️ 请求超时，第 ${item.retryCount + 1} 次重试...`);
          item.retryCount++;
          this.queue.unshift(item);
        } else {
          console.error(`❌ 请求超时，已重试${this.maxRetries}次，放弃请求`);
          item.reject(error);
        }
      } else {
        // Other errors - don't retry, just reject
        console.error(`❌ 请求失败（不重试）:`, error.message || error);
        item.reject(error);
      }
    }
  }
  
  /**
   * Check if we can make a request now
   */
  canMakeRequest() {
    // Clean up old timestamps (> 1 minute ago)
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    
    // Check rate limit
    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      return false;
    }
    
    // Check minimum interval
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.minInterval) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Calculate wait time until next request can be made
   */
  getWaitTime() {
    // Wait time for rate limit
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    
    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      const oldestTimestamp = this.requestTimestamps[0];
      const waitForRateLimit = oldestTimestamp + 60000 - Date.now();
      return Math.max(waitForRateLimit, 0);
    }
    
    // Wait time for minimum interval
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    const waitForInterval = this.minInterval - timeSinceLastRequest;
    
    return Math.max(waitForInterval, 0);
  }
  
  /**
   * Record a successful request
   */
  recordRequest() {
    const now = Date.now();
    this.lastRequestTime = now;
    this.requestTimestamps.push(now);
    this.requestCount++;
  }
  
  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      currentConcurrent: this.currentConcurrent,
      requestsInLastMinute: this.requestTimestamps.length,
      canMakeRequest: this.canMakeRequest()
    };
  }
}

// Create global request queue manager
const requestQueue = new RequestQueueManager();

/**
 * Generate unique key for a CSV row
 * @param {string} filename - CSV filename
 * @param {string|number} rowId - Row ID from CSV
 * @returns {string} Unique key like "vocab1-1234"
 */
function generateSyncKey(filename, rowId) {
  // Remove .csv extension and special characters
  const cleanFilename = filename.replace('.csv', '').replace(/[^a-zA-Z0-9]/g, '');
  return `${cleanFilename}-${rowId}`;
}

/**
 * Fetch all sync data from JSONBin.io via Cloudflare Worker
 * @returns {Promise<Object>} Object with all sync records
 */
async function fetchAllSyncData() {
  try {
    const response = await fetch(`${CLOUDFLARE_WORKER_URL}/latest`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`云端请求失败: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    console.log('✅ 从云端获取同步数据成功');
    
    return data.record || data || {};
  } catch (error) {
    console.error('❌ 获取云端数据失败:', error);
    console.warn('💡 提示: 请检查 CLOUDFLARE_WORKER_URL 配置是否正确');
    console.warn('💡 详见: CLOUDFLARE_WORKER_SETUP_GUIDE.md');
    return null;
  }
}

/**
 * Update sync data to JSONBin.io via Cloudflare Worker (with queue management)
 * @param {Object} allData - Complete sync data object
 * @returns {Promise<boolean>} Success status
 */
async function updateAllSyncData(allData) {
  console.log('ADLog-Edit: [updateAllSyncData] ========== 开始 ==========');
  console.log('ADLog-Edit: [updateAllSyncData] allData keys:', Object.keys(allData).length);
  console.log('ADLog-Edit: [updateAllSyncData] 准备加入请求队列...');
  
  // Enqueue the request
  return requestQueue.enqueue(async () => {
    try {
      console.log('ADLog-Edit: [updateAllSyncData] 请求已从队列取出，准备发送 fetch...');
      console.log('ADLog-Edit: [updateAllSyncData] URL:', `${CLOUDFLARE_WORKER_URL}/update`);
      console.log('ADLog-Edit: [updateAllSyncData] Method: PUT');
      
      const response = await fetch(`${CLOUDFLARE_WORKER_URL}/update`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(allData)
      });

      console.log('ADLog-Edit: [updateAllSyncData] fetch 返回 status:', response.status);

      if (response.status === 429) {
        console.log('ADLog-Edit: [updateAllSyncData] 收到 429 错误');
        const error = new Error('Too Many Requests');
        error.status = 429;
        throw error;
      }

      if (!response.ok) {
        console.error(`ADLog-Edit: [updateAllSyncData] 云端更新失败: ${response.status} ${response.statusText}`);
        console.error(`云端更新失败: ${response.status} ${response.statusText}`);
        return false;
      }

      console.log('ADLog-Edit: [updateAllSyncData] ✅ 同步成功！');
      console.log('✅ 同步数据到云端成功');
      return true;
    } catch (error) {
      console.log('ADLog-Edit: [updateAllSyncData] catch 到错误:', error.message);
      if (error.status === 429) {
        console.log('ADLog-Edit: [updateAllSyncData] 重新抛出 429 错误供队列管理器处理');
        throw error; // Re-throw 429 for queue manager to handle
      }
      console.error('❌ 更新云端数据失败:', error);
      console.warn('💡 提示: 请检查 CLOUDFLARE_WORKER_URL 配置是否正确');
      console.warn('💡 详见: CLOUDFLARE_WORKER_SETUP_GUIDE.md');
      return false;
    }
  });
}

/**
 * Get sync record for a specific key (only from cache, no network request)
 * @param {string} key - Unique key
 * @returns {Object|null} Sync record or null
 */
function getSyncRecord(key) {
  console.log(`ADLog-Edit: [getSyncRecord] 获取记录: ${key}`);
  
  // Only check in-memory cache (no network request)
  if (syncCache[key]) {
    console.log(`ADLog-Edit: [getSyncRecord] ✅ 在缓存中找到`);
    console.log(`ADLog-Edit: [getSyncRecord] 返回对象:`, JSON.stringify(syncCache[key]));
    console.log(`📦 从缓存读取: ${key}`);
    return syncCache[key];
  }

  console.log(`ADLog-Edit: [getSyncRecord] ❌ 缓存中未找到，返回 null`);
  return null;
}

/**
 * Update single sync record to cloud (optimized: only sends single record)
 * @param {string} key - Unique key
 * @param {Object} record - Record data
 * @param {Object} options - Update options
 * @returns {Promise<{success: boolean, record: Object|null}>} Success status and updated record
 */
async function updateSingleSyncRecord(key, record, options = {}) {
  console.log('ADLog-Edit: [updateSingleSyncRecord] ========== 开始 ==========');
  console.log('ADLog-Edit: [updateSingleSyncRecord] key =', key);
  console.log('ADLog-Edit: [updateSingleSyncRecord] record =', JSON.stringify(record));
  console.log('ADLog-Edit: [updateSingleSyncRecord] options =', options);
  
  // Check if data actually changed
  const existingData = syncCache[key];
  console.log('ADLog-Edit: [updateSingleSyncRecord] existingData =', JSON.stringify(existingData));
  
  if (existingData && !options.force) {
    console.log('ADLog-Edit: [updateSingleSyncRecord] 准备比较数据是否变更...');
    // Compare data to detect changes
    const hasChanged = !isDataEqual(existingData, record);
    console.log('ADLog-Edit: [updateSingleSyncRecord] hasChanged =', hasChanged);
    
    if (!hasChanged) {
      console.log('ADLog-Edit: [updateSingleSyncRecord] ⏭️  数据未变更，跳过同步');
      console.log(`⏭️  跳过同步（数据未变更）: ${key}`);
      syncCacheModified[key] = false;
      return { success: true, record: existingData }; // Return existing record
    }
  } else {
    console.log('ADLog-Edit: [updateSingleSyncRecord] 跳过变更检测（existingData 为空或 force=true）');
  }
  
  // Mark as modified
  syncCacheModified[key] = true;
  console.log('ADLog-Edit: [updateSingleSyncRecord] 标记为已修改');
  
  // Update in-memory cache first (optimistic update)
  syncCache[key] = record;
  console.log('ADLog-Edit: [updateSingleSyncRecord] 已更新内存缓存');
  
  console.log(`🔄 准备同步单条数据到云端: ${key}`, record);

  // Retry with exponential backoff (max 3 retries)
  const maxRetries = 3;
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount <= maxRetries) {
    try {
      const startTime = performance.now();
      
      // Enqueue the request with timeout
      const response = await requestQueue.enqueue(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
        
        try {
          const response = await fetch(`${CLOUDFLARE_WORKER_URL}/update`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ key, record }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (response.status === 429) {
            const error = new Error('Too Many Requests');
            error.status = 429;
            throw error;
          }
          
          if (!response.ok) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            error.status = response.status;
            throw error;
          }
          
          const data = await response.json();
          const elapsed = performance.now() - startTime;
          console.log(`ADLog-Edit: [updateSingleSyncRecord] ✅ 同步成功！耗时: ${elapsed.toFixed(2)}ms`);
          
          // Update cache with returned record (in case server modified it)
          if (data.record) {
            syncCache[key] = data.record;
          }
          
          syncCacheModified[key] = false; // Reset modified flag after successful sync
          
          return { success: true, record: data.record || record };
          
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            throw new Error('Request timeout (5s)');
          }
          throw error;
        }
      });
      
      if (response.success) {
        console.log(`✅ 同步单条记录成功: ${key}`, response.record);
        return response;
      }
      
      // If enqueue returned false, retry
      throw new Error('Request queue rejected');
      
    } catch (error) {
      lastError = error;
      retryCount++;
      
      if (error.status === 429 || error.status >= 500) {
        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.min(1000 * Math.pow(2, retryCount - 1), 4000);
        console.warn(`ADLog-Edit: [updateSingleSyncRecord] ⚠️ 请求失败 (${error.status}), ${backoffMs}ms 后重试 (${retryCount}/${maxRetries})`);
        
        if (retryCount <= maxRetries) {
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue; // Retry
        }
      }
      
      // Non-retryable error or max retries reached
      console.error(`ADLog-Edit: [updateSingleSyncRecord] ❌ 同步失败: ${error.message}`);
      break;
    }
  }
  
  // All retries failed
  console.warn(`⚠️ 同步失败，数据已保存到本地缓存: ${key}`, lastError);
  return { success: false, record: record }; // Return local record even on failure
}

/**
 * Update or create sync record (legacy function, for backward compatibility)
 * @param {string} key - Unique key
 * @param {Object} record - Record data
 * @param {Object} options - Update options
 * @returns {Promise<boolean>} Success status
 */
async function updateSyncRecord(key, record, options = {}) {
  // Use optimized single record update
  const result = await updateSingleSyncRecord(key, record, options);
  return result.success;
}

/**
 * Check if two data objects are equal
 * @param {Object} obj1 - First object
 * @param {Object} obj2 - Second object
 * @returns {boolean} True if equal
 */
function isDataEqual(obj1, obj2) {
  console.log('ADLog-Edit: [isDataEqual] 开始比较对象');
  console.log('ADLog-Edit: [isDataEqual] obj1 =', JSON.stringify(obj1));
  console.log('ADLog-Edit: [isDataEqual] obj2 =', JSON.stringify(obj2));
  console.log('ADLog-Edit: [isDataEqual] obj1 === obj2 (同一引用)?', obj1 === obj2);
  
  if (!obj1 || !obj2) {
    console.log('ADLog-Edit: [isDataEqual] 其中一个对象为空，返回 false');
    return false;
  }
  
  // Compare relevant fields
  const keysToCompare = ['stars', 'filterLevel', 'sortByStars', 'lastViewedRow'];
  
  for (const key of keysToCompare) {
    console.log(`ADLog-Edit: [isDataEqual] 比较 ${key}: obj1.${key}=${obj1[key]}, obj2.${key}=${obj2[key]}`);
    if (obj1[key] !== obj2[key]) {
      console.log(`ADLog-Edit: [isDataEqual] ${key} 不相等，返回 false`);
      return false;
    }
  }
  
  console.log('ADLog-Edit: [isDataEqual] 所有字段都相等，返回 true');
  return true;
}

/**
 * Check if a key exists in sync data
 * @param {string} key - Unique key
 * @returns {Promise<boolean>} True if exists
 */
async function syncRecordExists(key) {
  const record = await getSyncRecord(key);
  return record !== null;
}

/**
 * Check if item is in visible range (current batch ± 1)
 * @param {number} itemIndex - Item index in allItems
 * @returns {boolean} True if in visible range
 */
function isInVisibleRange(itemIndex) {
  if (allItems.length === 0) return false;
  
  // Calculate item's batch
  const itemBatch = Math.floor(itemIndex / BATCH_SIZE);
  
  // Visible range: current batch ± 1 (total 3 batches max)
  const minBatch = Math.max(0, currentBatch - 1);
  const maxBatch = Math.min(
    Math.ceil(allItems.length / BATCH_SIZE) - 1,
    currentBatch + 1
  );
  
  return itemBatch >= minBatch && itemBatch <= maxBatch;
}

/**
 * Check and update sync status for a specific row (cache-only, no network requests)
 * @param {string} key - Unique sync key
 * @param {HTMLElement} statusElement - DOM element to update
 * @param {string} itemId - Item ID
 * @param {string|number} rowId - Row ID
 * @param {HTMLElement} cardElement - Card DOM element for UI update
 * @param {number} itemIndex - Item index in allItems array
 */
function checkSyncStatus(key, statusElement, itemId, rowId, cardElement, itemIndex) {
  try {
    // Check if record exists in cache (no network request)
    const record = syncCache[key];
    
    if (record) {
      // Record exists in cache
      statusElement.className = 'sync-status synced';
      statusElement.textContent = 'Synced';
      statusElement.title = '已同步到云端';
      
      // Update local ratings from cache if different
      if (record.stars !== undefined && ratings[itemId] !== record.stars) {
        const oldStars = ratings[itemId] || 0;
        ratings[itemId] = record.stars;
        console.log(`🔄 从缓存恢复星级: ${key} → ${record.stars}星 (原: ${oldStars}星)`);
        
        // Update stars UI in the card
        if (cardElement) {
          updateCardStars(cardElement, itemId, record.stars);
        }
        
        // Save to localStorage
        if (currentFile) {
          saveRatings(currentFile, ratings);
        }
      }
    } else {
      // No record in cache - show local status
      // Don't create new records here to avoid flooding requests
      // Let batchSyncFromCloud handle initial sync
      statusElement.className = 'sync-status not-synced';
      statusElement.textContent = 'Local';
      statusElement.title = '本地数据（等待同步）';
    }
  } catch (error) {
    // Error occurred, log but don't block
    statusElement.className = 'sync-status unknown';
    statusElement.textContent = '⚠️';
    statusElement.title = '同步状态未知';
    console.warn(`⚠️ 检查同步状态失败: ${key}`, error.message || error);
  }
}

/**
 * Update stars display in a card element
 * @param {HTMLElement} cardElement - Card DOM element
 * @param {string} itemId - Item ID
 * @param {number} stars - Number of stars (0-5)
 */
function updateCardStars(cardElement, itemId, stars) {
  const starsWrap = cardElement.querySelector('.stars');
  if (!starsWrap) return;
  
  // Update all star elements
  const starElements = starsWrap.querySelectorAll('.star');
  starElements.forEach((star, index) => {
    const starValue = index + 1;
    if (starValue <= stars) {
      star.classList.add('active');
    } else {
      star.classList.remove('active');
    }
  });
  
  console.log(`✨ UI已更新: ${itemId} → ${stars}星`);
}

/**
 * Batch sync all data from cloud for current file
 * This is called after CSV is loaded to restore user's learning progress
 */
async function batchSyncFromCloud() {
  if (!currentFile) {
    console.warn('⚠️ 无当前文件，跳过云端同步');
    return;
  }
  
  // Check if we already have cache data - avoid redundant requests
  if (Object.keys(syncCache).length > 0) {
    console.log('📦 使用现有缓存数据，跳过云端同步');
    return;
  }
  
  console.log('🔄 开始从云端批量同步数据（这是唯一的网络请求）...');
  const startTime = performance.now();
  
  try {
    // Show loading indicator
    const loadingIndicator = showLoadingIndicator('正在从云端同步数据...');
    
    // Fetch all cloud data - THIS IS THE ONLY NETWORK REQUEST
    const allCloudData = await fetchAllSyncData();
    
    if (!allCloudData) {
      console.warn('⚠️ 无法获取云端数据，将仅使用本地数据');
      hideLoadingIndicator(loadingIndicator);
      return;
    }
    
    // Update syncCache - all subsequent checks use this cache
    syncCache = allCloudData;
    console.log(`📦 缓存已更新：${Object.keys(syncCache).length} 条记录`);
    
    // Count updated items
    let updatedCount = 0;
    let lastViewedRow = null;
    
    // Restore global settings first
    const globalKey = `${currentFile.replace('.csv', '')}_settings`;
    if (allCloudData[globalKey]) {
      const cloudSettings = allCloudData[globalKey];
      
      if (cloudSettings.filterLevel !== undefined) {
        filterStarsLevel = cloudSettings.filterLevel;
        const filterSelect = document.getElementById('filterStars');
        if (filterSelect) {
          filterSelect.value = filterStarsLevel;
        }
      }
      
      if (cloudSettings.sortByStars !== undefined) {
        sortByStars = cloudSettings.sortByStars;
        const toggleSortCheckbox = document.getElementById('toggleSortByStars');
        const sortLabel = document.getElementById('sortLabel');
        if (toggleSortCheckbox) {
          toggleSortCheckbox.checked = sortByStars;
        }
        if (sortLabel) {
          sortLabel.textContent = sortByStars ? '原始顺序' : '星级排序';
        }
      }
      
      if (cloudSettings.lastViewedRow !== undefined && cloudSettings.lastViewedRow !== null) {
        lastViewedRow = cloudSettings.lastViewedRow;
      }
      
      console.log('☁️ 全局设置已恢复:', cloudSettings);
    }
    
    // Restore ratings for all items
    for (const key in allCloudData) {
      if (key.startsWith(currentFile.replace('.csv', '')) && key !== globalKey) {
        const record = allCloudData[key];
        if (record.stars !== undefined) {
          // Find itemId by key
          const rowIdFromKey = key.split('-')[1];
          if (rowIdFromKey !== undefined) {
            // Find matching item in allItems
            const matchingItem = allItems.find(item => {
              const itemRowId = item.row['id'] !== undefined ? item.row['id'] : item.idx;
              return String(itemRowId) === String(rowIdFromKey);
            });
            
            if (matchingItem) {
              const oldStars = ratings[matchingItem.id] || 0;
              if (oldStars !== record.stars) {
                ratings[matchingItem.id] = record.stars;
                updatedCount++;
              }
            }
          }
        }
      }
    }
    
    // Save updated ratings to localStorage
    if (updatedCount > 0 && currentFile) {
      saveRatings(currentFile, ratings);
      console.log(`💾 ${updatedCount} 条星级数据已保存到本地`);
    }
    
    hideLoadingIndicator(loadingIndicator);
    
    const elapsed = performance.now() - startTime;
    console.log(`✅ 云端同步完成：更新 ${updatedCount} 条数据，耗时 ${elapsed.toFixed(2)}ms`);
    
    // Note: Rendering will be handled by the caller (loadFile)
    // Store last viewed row for later use
    if (lastViewedRow !== null && lastViewedRow > 0) {
      // Schedule scroll after rendering completes
      setTimeout(() => {
        scrollToRow(lastViewedRow);
        console.log(`📍 已滚动到上次浏览位置：第 ${lastViewedRow} 行`);
      }, 500); // Wait for rendering to complete
    }
    
  } catch (error) {
    console.error('❌ 批量同步失败:', error);
  }
}

/**
 * Show loading indicator
 * @param {string} message - Loading message
 * @returns {HTMLElement} Loading indicator element
 */
function showLoadingIndicator(message) {
  const existing = document.getElementById('cloud-sync-loading');
  if (existing) {
    return existing;
  }
  
  const indicator = document.createElement('div');
  indicator.id = 'cloud-sync-loading';
  indicator.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 20px 40px;
    border-radius: 8px;
    z-index: 10000;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  indicator.textContent = message || '加载中...';
  document.body.appendChild(indicator);
  return indicator;
}

/**
 * Hide loading indicator
 * @param {HTMLElement} indicator - Loading indicator element
 */
function hideLoadingIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.parentNode.removeChild(indicator);
  }
}

/**
 * Save last viewed row to cloud
 * @param {number} rowNum - Row number
 */
async function saveLastViewedRow(rowNum) {
  if (!currentFile) return;
  
  const globalKey = `${currentFile.replace('.csv', '')}_settings`;
  let settings = await getSyncRecord(globalKey);
  
  if (!settings) {
    settings = {
      key: globalKey,
      filterLevel: filterStarsLevel,
      sortByStars: sortByStars,
      lastViewedRow: rowNum,
      lastUpdated: new Date().toISOString()
    };
  } else {
    settings.lastViewedRow = rowNum;
    settings.lastUpdated = new Date().toISOString();
  }
  
  await updateSyncRecord(globalKey, settings);
  console.log(`📍 保存浏览位置: 第 ${rowNum} 行`);
}

// ==================== Storage Helpers ====================
const HISTORY_KEY = 'csv_history_v2';

function saveJSON(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.error(`localStorage配额已满，无法保存键"${k}"的数据。`);
      throw e; // Re-throw to let caller handle it
    } else {
      console.error(`保存数据到localStorage失败（键: ${k}）:`, e);
      throw e;
    }
  }
}

function loadJSON(k, def = null) {
  try {
    const s = localStorage.getItem(k);
    return s ? JSON.parse(s) : def;
  } catch (e) {
    return def;
  }
}

// ==================== CSV Parsing ====================
function parseCSV(text) {
  // RFC-style simple parser handling quoted fields
  const rows = [];
  let cur = '';
  let row = [];
  let inQ = false;
  
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        row.push(cur);
        cur = '';
      } else if (ch === '\r') {
        continue;
      } else if (ch === '\n') {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  
  // Remove empty trailing rows
  return rows.filter(r => r.some(c => c !== ''));
}

function rowId(filename, row) {
  // Stable id per row content
  const s = JSON.stringify(row);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) * 16777619 >>> 0;
  }
  return filename + '_r_' + h.toString(16);
}

// ==================== App State ====================
let currentFile = null;
let rows = []; // Array of arrays
let ratings = {}; // id -> 0..5
let currentRowNum = 1; // Current displayed row number
let totalRows = 0; // Total data rows (excluding header)
let scrollAnimationId = null; // For interrupting ongoing scroll animations
let isViewsHidden = false; // Track visibility state of fixed views
let isSpeechSupported = false; // Track if SpeechSynthesis API is supported
let currentSpeechButton = null; // Track currently speaking button
let showDefinition = true; // Track definition field visibility
let showSentence = true; // Track sentence field visibility
let filterStarsLevel = 'all'; // Track filter level (0-5 or 'all')
let sortByStars = false; // Track if sorting by stars

// Performance optimization: Virtual scrolling
let allItems = []; // All sorted items
let displayedItems = []; // Currently displayed items
let currentBatch = 0; // Current batch index
const BATCH_SIZE = 100; // Items per batch
let isLoadingMore = false; // Prevent multiple simultaneous loads

// ==================== Speech Synthesis Functions ====================
/**
 * Check if SpeechSynthesis API is supported
 */
function checkSpeechSupport() {
  if ('speechSynthesis' in window) {
    isSpeechSupported = true;
    console.log('SpeechSynthesis API 已支持');
    return true;
  } else {
    isSpeechSupported = false;
    console.warn('SpeechSynthesis API not supported');
    return false;
  }
}

/**
 * Speak text using SpeechSynthesis API
 * @param {string} text - Text to speak
 * @param {HTMLElement} button - Button element for visual feedback
 */
function speakText(text, button = null) {
  if (!isSpeechSupported) {
    console.warn('语音朗读功能不可用');
    return;
  }
  
  try {
    // Validate input
    if (!text || typeof text !== 'string' || text.trim() === '' || text === '—') {
      console.log('无有效内容可朗读');
      return;
    }
    
    const startTime = performance.now();
    
    // Stop any ongoing speech
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      
      // Remove reading state from previous button
      if (currentSpeechButton && currentSpeechButton !== button) {
        currentSpeechButton.classList.remove('reading');
      }
    }
    
    // Create utterance
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configure voice settings
    utterance.lang = 'en-US'; // English pronunciation
    utterance.rate = 0.9; // Slightly slower for clarity
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Event handlers
    utterance.onstart = () => {
      const responseTime = performance.now() - startTime;
      console.log(`语音播放已启动，响应时间 ${responseTime.toFixed(2)}ms`);
      
      if (responseTime > 100) {
        console.warn(`响应时间警告：启动耗时 ${responseTime.toFixed(2)}ms，超过 100ms 目标`);
      }
      
      if (button) {
        button.classList.add('reading');
        currentSpeechButton = button;
      }
    };
    
    utterance.onend = () => {
      console.log('语音播放已结束');
      if (button) {
        button.classList.remove('reading');
      }
      if (currentSpeechButton === button) {
        currentSpeechButton = null;
      }
    };
    
    utterance.onerror = (event) => {
      console.error('语音播放错误:', event.error);
      if (button) {
        button.classList.remove('reading');
      }
      if (currentSpeechButton === button) {
        currentSpeechButton = null;
      }
    };
    
    // Start speaking
    window.speechSynthesis.speak(utterance);
    
  } catch (error) {
    console.error('speakText 函数执行异常:', error);
    if (button) {
      button.classList.remove('reading');
    }
  }
}

/**
 * Stop current speech
 */
function stopSpeech() {
  if (isSpeechSupported && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (currentSpeechButton) {
      currentSpeechButton.classList.remove('reading');
      currentSpeechButton = null;
    }
  }
}

// ==================== DOM Elements ====================
const fileInput = document.getElementById('fileInput');
const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');
const historyBtn = document.getElementById('historyBtn');
const historyList = document.getElementById('historyList');

// Scroll control elements
const scrollSlider = document.getElementById('scrollSlider');
const rowInfo = document.getElementById('rowInfo');
const jumpInput = document.getElementById('jumpInput');
const goBtn = document.getElementById('goBtn');

// Toggle view elements
const headerEl = document.querySelector('header');
const scrollControlEl = document.querySelector('.scroll-control');
const mainEl = document.querySelector('main');
const toggleViewBtn = document.getElementById('toggleViewBtn');
const floatingToggleBtn = document.getElementById('floatingToggleBtn');

// Theme elements
const sw0 = document.getElementById('sw0');
const sw1 = document.getElementById('sw1');
const sw2 = document.getElementById('sw2');
const sw3 = document.getElementById('sw3');
const sw4 = document.getElementById('sw4'); // 牛皮纸主题
const sw5 = document.getElementById('sw5'); // 泛黄树叶主题

// ==================== View Toggle Functions ====================
function toggleFixedViews() {
  const startTime = performance.now();
  
  // Check if elements exist
  if (!headerEl || !scrollControlEl || !mainEl) {
    console.warn('固定视图元素未加载完成，操作失效');
    return;
  }
  
  isViewsHidden = !isViewsHidden;
  
  if (isViewsHidden) {
    // Hide fixed views
    headerEl.classList.add('hidden');
    scrollControlEl.classList.add('hidden');
    mainEl.classList.add('expanded');
    floatingToggleBtn.classList.add('visible');
    console.log('固定视图已隐藏');
  } else {
    // Show fixed views
    headerEl.classList.remove('hidden');
    scrollControlEl.classList.remove('hidden');
    mainEl.classList.remove('expanded');
    floatingToggleBtn.classList.remove('visible');
    console.log('固定视图已恢复');
  }
  
  // Save state to localStorage
  localStorage.setItem('csv_views_hidden_v1', isViewsHidden);
  
  // Re-adjust mobile layout after toggle (with small delay for animation)
  setTimeout(() => {
    if (typeof adjustMobileLayout === 'function') {
      adjustMobileLayout();
    }
  }, 350); // After transition completes
  
  const responseTime = performance.now() - startTime;
  if (responseTime > 100) {
    console.warn(`响应时间警告：视图切换耗时 ${responseTime.toFixed(2)}ms，超过 100ms 目标`);
  } else {
    console.log(`视图切换完成，耗时 ${responseTime.toFixed(2)}ms`);
  }
}

function restoreViewState() {
  const savedState = localStorage.getItem('csv_views_hidden_v1');
  if (savedState === 'true') {
    // Apply hidden state without animation (instant)
    if (headerEl) headerEl.style.transition = 'none';
    if (scrollControlEl) scrollControlEl.style.transition = 'none';
    if (mainEl) mainEl.style.transition = 'none';
    
    isViewsHidden = false; // Set to false first so toggle will set to true
    toggleFixedViews();
    
    // Re-enable transitions after a frame
    requestAnimationFrame(() => {
      if (headerEl) headerEl.style.transition = '';
      if (scrollControlEl) scrollControlEl.style.transition = '';
      if (mainEl) mainEl.style.transition = '';
    });
  }
}

// ==================== History Management ====================
function loadHistory() {
  return loadJSON(HISTORY_KEY, []);
}

function saveHistory(h) {
  saveJSON(HISTORY_KEY, h);
}

function addHistory(name) {
  let h = loadHistory();
  if (!h.includes(name)) {
    h.push(name);
    saveHistory(h);
  }
}

function removeHistory(name) {
  let h = loadHistory();
  h = h.filter(x => x !== name);
  saveHistory(h);
}

function saveCsv(name, rows) {
  // ⚠️ Disabled: Large CSV files exceed localStorage quota (5-10MB)
  // Only save file name to history, not the content
  try {
    // Attempt to save only if file is small (< 1MB estimated)
    const dataSize = JSON.stringify(rows).length;
    if (dataSize < 1000000) { // ~1MB
      saveJSON('csv_data_' + name, rows);
      console.log(`CSV内容已保存到本地存储（大小: ${(dataSize / 1024).toFixed(2)} KB）`);
    } else {
      console.warn(`CSV文件过大（${(dataSize / 1024 / 1024).toFixed(2)} MB），跳过本地存储。请重新选择文件加载数据。`);
    }
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.error('localStorage配额已满，无法保存CSV内容。已保存文件名到历史记录。');
    } else {
      console.error('保存CSV失败:', e);
    }
  }
}

function loadCsv(name) {
  return loadJSON('csv_data_' + name, null);
}

function saveRatings(name, ratings) {
  try {
    saveJSON('csv_ratings_' + name, ratings);
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.error('localStorage配额已满，无法保存评分数据。');
      alert('警告：本地存储空间不足，评分数据可能无法保存。\n\n建议：\n1. 清理浏览器缓存\n2. 使用较小的CSV文件');
    } else {
      console.error('保存评分失败:', e);
    }
  }
}

function loadRatings(name) {
  return loadJSON('csv_ratings_' + name, {});
}

function renderHistory() {
  const h = loadHistory();
  historyList.innerHTML = '';
  
  if (!h.length) {
    historyList.innerHTML = '<div class="small" style="padding:8px">无历史记录</div>';
    return;
  }
  
  // Show newest first
  h.slice().reverse().forEach(name => {
    const it = document.createElement('div');
    it.className = 'history-item';
    
    const left = document.createElement('div');
    left.className = 'name';
    left.textContent = name;
    
    const right = document.createElement('div');
    
    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn';
    loadBtn.textContent = '加载';
    loadBtn.onclick = () => {
      loadFromHistory(name);
      toggleHistory(false);
    };
    
    const delBtn = document.createElement('button');
    delBtn.className = 'reset';
    delBtn.textContent = '删除';
    delBtn.onclick = () => {
      if (confirm('从历史中删除 "' + name + '" ? （不会删除评分）')) {
        removeHistory(name);
        renderHistory();
      }
    };
    
    right.appendChild(loadBtn);
    right.appendChild(delBtn);
    it.appendChild(left);
    it.appendChild(right);
    historyList.appendChild(it);
  });
}

function toggleHistory(show) {
  if (show) {
    historyList.style.display = 'block';
    renderHistory();
    
    // Calculate position dynamically
    const btnRect = historyBtn.getBoundingClientRect();
    const listRect = historyList.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Position below button
    let top = btnRect.bottom + 8;
    let left = btnRect.left;
    
    // Ensure at least 100px from left edge
    if (left < 100) {
      left = 100;
    }
    
    // Ensure at least 100px from right edge
    if (left + listRect.width > viewportWidth - 100) {
      left = viewportWidth - listRect.width - 100;
    }
    
    // Ensure doesn't overflow bottom
    if (top + listRect.height > viewportHeight - 20) {
      top = btnRect.top - listRect.height - 8;
    }
    
    historyList.style.top = top + 'px';
    historyList.style.left = left + 'px';
  } else {
    historyList.style.display = 'none';
  }
}

// ==================== File Input Handling ====================
fileInput.addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  
  const text = await f.text();
  const parsed = parseCSV(text);
  const name = f.name;
  
  saveCsv(name, parsed);
  addHistory(name);
  loadFile(name, parsed);
});

function loadFromHistory(name) {
  const data = loadCsv(name);
  if (!data) {
    alert(`文件"${name}"的内容未保存在本地存储中（可能因文件过大）。\n\n请点击"选择 CSV"按钮重新选择该文件。`);
    return;
  }
  loadFile(name, data);
}

async function loadFile(name, data) {
  currentFile = name;
  rows = data;
  ratings = loadRatings(name) || {};
  
  // Batch sync from cloud BEFORE rendering
  // This ensures syncCache is populated when checkSyncStatus is called
  await batchSyncFromCloud();
  
  // Now render with cloud data already in cache
  renderCards();
}

// ==================== Scroll Control Functions ====================
function updateScrollControls() {
  // Calculate total rows (excluding header)
  totalRows = rows && rows.length > 1 ? rows.length - 1 : 0;
  
  if (totalRows === 0) {
    // Disable all controls
    scrollSlider.disabled = true;
    jumpInput.disabled = true;
    goBtn.disabled = true;
    scrollSlider.max = 1;
    scrollSlider.value = 1;
    rowInfo.textContent = '当前显示第 0 条 / 共 0 条';
    currentRowNum = 1;
  } else {
    // Enable controls
    scrollSlider.disabled = false;
    jumpInput.disabled = false;
    goBtn.disabled = false;
    scrollSlider.max = totalRows;
    jumpInput.max = totalRows;
    
    // Reset to first row
    currentRowNum = 1;
    scrollSlider.value = 1;
    jumpInput.value = '';
    updateRowInfo();
  }
}

function updateRowInfo() {
  rowInfo.textContent = `当前显示第 ${currentRowNum} 条 / 共 ${totalRows} 条`;
}

function scrollToRow(rowNum, forceImmediate = false) {
  if (rowNum < 1 || rowNum > totalRows || !totalRows) return false;
  
  // Interrupt any ongoing scroll animation
  if (scrollAnimationId !== null) {
    cancelAnimationFrame(scrollAnimationId);
    scrollAnimationId = null;
  }
  
  // Find card with matching original row index
  let targetCard = cardsEl.querySelector(`.card[data-row-index="${rowNum}"]`);
  
  // If card not rendered yet, use smart loading strategy
  if (!targetCard && allItems.length > 0) {
    // CRITICAL: Find the item's position in the SORTED array (allItems)
    // Because data is sorted by rating, original row number ≠ sorted position
    const targetItemIndex = allItems.findIndex(item => item.idx === rowNum - 1);
    
    if (targetItemIndex === -1) {
      console.warn(`在排序后的数据中未找到原始行 ${rowNum}`);
      return false;
    }
    
    // Calculate which batch this item is in (based on sorted position, not original row number)
    const targetBatchIndex = Math.floor(targetItemIndex / BATCH_SIZE);
    const currentLastBatch = Math.floor((displayedItems.length - 1) / BATCH_SIZE);
    
    console.log(`目标行 ${rowNum} 在排序后的位置 ${targetItemIndex}，批次 ${targetBatchIndex + 1}，当前已加载到批次 ${currentBatch + 1}`);
    
    // Strategy: If jumping far away (forward or backward), clear and render target batch directly
    // This avoids rendering thousands of intermediate items
    const jumpDistance = Math.abs(targetBatchIndex - currentBatch);
    
    if (jumpDistance > 5) {
      console.log(`远距离跳转（距离${jumpDistance}个批次）：清空当前显示，直接渲染目标批次附近`);
      
      // Clear current display
      cardsEl.innerHTML = '';
      displayedItems = [];
      
      // Render target batch and surrounding batches (for smooth scrolling)
      const startBatch = Math.max(0, targetBatchIndex - 1);
      const endBatch = Math.min(Math.ceil(allItems.length / BATCH_SIZE) - 1, targetBatchIndex + 2);
      
      currentBatch = startBatch;
      
      for (let i = startBatch; i <= endBatch; i++) {
        renderNextBatch();
      }
      
      console.log(`已渲染批次 ${startBatch + 1} 到 ${endBatch + 1}`);
    } else if (targetBatchIndex >= currentBatch) {
      // Close range forward: render sequentially
      const targetBatchCount = targetBatchIndex + 1;
      while (currentBatch < targetBatchCount && displayedItems.length < allItems.length) {
        renderNextBatch();
      }
    } else {
      // Close range backward: target batch is before current, need to re-render
      console.log(`向后跳转：清空当前显示，重新渲染目标批次附近`);
      
      cardsEl.innerHTML = '';
      displayedItems = [];
      
      const startBatch = Math.max(0, targetBatchIndex - 1);
      const endBatch = Math.min(Math.ceil(allItems.length / BATCH_SIZE) - 1, targetBatchIndex + 2);
      
      currentBatch = startBatch;
      
      for (let i = startBatch; i <= endBatch; i++) {
        renderNextBatch();
      }
      
      console.log(`已渲染批次 ${startBatch + 1} 到 ${endBatch + 1}`);
    }
    
    // Try finding the card again
    targetCard = cardsEl.querySelector(`.card[data-row-index="${rowNum}"]`);
  }
  
  if (!targetCard) {
    console.warn(`无法找到行 ${rowNum} 对应的卡片`);
    return false;
  }
  
  const startTime = performance.now();
  
  // Determine scroll behavior based on data size
  // For large datasets (>= 5000 rows), use instant jump for better performance
  const useInstantScroll = forceImmediate || totalRows >= 5000;
  
  // Update current state immediately for responsive UI
  currentRowNum = rowNum;
  scrollSlider.value = rowNum;
  updateRowInfo();
  
  if (useInstantScroll) {
    // Instant jump without animation
    targetCard.scrollIntoView({ behavior: 'auto', block: 'start' });
    
    const scrollTime = performance.now() - startTime;
    console.log(`即时跳转到第 ${rowNum} 行，耗时 ${scrollTime.toFixed(2)}ms`);
    
    // Check if response time is within 100ms requirement
    if (scrollTime > 100) {
      console.warn(`响应时间警告：即时跳转耗时 ${scrollTime.toFixed(2)}ms，超过 100ms 目标`);
    }
    
    // Save last viewed row to cloud (async, don't block)
    saveLastViewedRow(rowNum);
    
    return true;
  } else {
    // Smooth scroll with fixed 0.5s duration using custom animation
    const startPosition = window.pageYOffset;
    const targetPosition = targetCard.getBoundingClientRect().top + window.pageYOffset - 120;
    const distance = targetPosition - startPosition;
    const duration = 500; // Fixed 500ms animation
    let startTimestamp = null;
    
    function animateScroll(timestamp) {
      if (!startTimestamp) startTimestamp = timestamp;
      const elapsed = timestamp - startTimestamp;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function (ease-in-out)
      const easeInOutCubic = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      
      window.scrollTo(0, startPosition + distance * easeInOutCubic);
      
      if (progress < 1) {
        scrollAnimationId = requestAnimationFrame(animateScroll);
      } else {
        scrollAnimationId = null;
        const scrollTime = performance.now() - startTime;
        console.log(`平滑滚动到第 ${rowNum} 行，总耗时 ${scrollTime.toFixed(2)}ms`);
        
        // Save last viewed row to cloud after animation completes
        saveLastViewedRow(rowNum);
      }
    }
    
    // Check initial response time (should start animation within 100ms)
    const responseTime = performance.now() - startTime;
    if (responseTime > 100) {
      console.warn(`响应时间警告：动画启动耗时 ${responseTime.toFixed(2)}ms，超过 100ms 目标`);
    }
    
    scrollAnimationId = requestAnimationFrame(animateScroll);
    
    return true;
  }
}

// ==================== Scroll Control Event Listeners ====================
// Slider events - Update display while dragging (no scroll)
scrollSlider.addEventListener('input', function() {
  const rowNum = parseInt(this.value);
  currentRowNum = rowNum;
  updateRowInfo();
});

// Scroll when released
scrollSlider.addEventListener('change', function() {
  const rowNum = parseInt(this.value);
  scrollToRow(rowNum);
});

// Jump input validation
jumpInput.addEventListener('input', function() {
  this.classList.remove('error');
  // Only allow positive integers
  this.value = this.value.replace(/[^\d]/g, '');
});

// Go button click
goBtn.addEventListener('click', function() {
  const inputValue = jumpInput.value.trim();
  if (!inputValue) {
    jumpInput.classList.add('error');
    return;
  }
  
  const rowNum = parseInt(inputValue);
  
  if (isNaN(rowNum) || rowNum < 1 || rowNum > totalRows) {
    jumpInput.classList.add('error');
    console.warn(`行号超出范围：${rowNum}，有效范围 1-${totalRows}`);
    return;
  }
  
  jumpInput.classList.remove('error');
  scrollToRow(rowNum);
});

// Allow Enter key in jump input
jumpInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    goBtn.click();
  }
});

// Track scroll position and update slider/row info accordingly
// Also handle auto-loading more items
let scrollTimeout;
window.addEventListener('scroll', function() {
  if (totalRows === 0) return;
  
  // Don't update during programmatic scroll animation
  if (scrollAnimationId !== null) return;
  
  // Debounce scroll event for performance
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(function() {
    // Skip if animation is running
    if (scrollAnimationId !== null) return;
    
    // Find the first visible card
    const cards = cardsEl.querySelectorAll('.card');
    let visibleCard = null;
    
    for (let card of cards) {
      const rect = card.getBoundingClientRect();
      // Check if card is in viewport (below the fixed headers)
      if (rect.top >= 150 && rect.top <= window.innerHeight / 2) {
        visibleCard = card;
        break;
      }
    }
    
    if (visibleCard) {
      const rowIndex = parseInt(visibleCard.dataset.rowIndex);
      if (rowIndex && rowIndex !== currentRowNum) {
        currentRowNum = rowIndex;
        scrollSlider.value = rowIndex;
        updateRowInfo();
        
        // ✅ 记录位置到云端（滚动停止后500ms）
        clearTimeout(window.positionSaveTimeout);
        window.positionSaveTimeout = setTimeout(() => {
          if (currentFile && rowIndex) {
            saveLastViewedRow(rowIndex);
          }
        }, 500);
      }
    }
    
    // Auto-load more items when near bottom
    checkAndLoadMore();
  }, 150);
});

/**
 * Check if user scrolled near bottom and load more items
 */
function checkAndLoadMore() {
  if (isLoadingMore) return;
  if (displayedItems.length >= allItems.length) return;
  
  const scrollPosition = window.pageYOffset + window.innerHeight;
  const pageHeight = document.documentElement.scrollHeight;
  
  // Load more when within 500px of bottom
  if (pageHeight - scrollPosition < 500) {
    console.log('接近底部，自动加载更多...');
    renderNextBatch();
  }
}

// ==================== Card Rendering ====================
/**
 * Render cards with optional position preservation
 * @param {Object} options - Rendering options
 * @param {boolean} options.preservePosition - Whether to preserve scroll position (default: false)
 */
function renderCards(options = {}) {
  const { preservePosition = false } = options;
  const startTime = performance.now();
  
  // Save current position before re-rendering (if preservePosition is true)
  let savedRowNum = null;
  if (preservePosition && allItems.length > 0) {
    // Find the first visible card's row number
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight) {
        savedRowNum = parseInt(card.dataset.rowIndex);
        console.log(`💾 保存当前位置：第 ${savedRowNum} 行`);
        break;
      }
    }
  }
  
  if (!rows || !rows.length) {
    cardsEl.innerHTML = '';
    emptyEl.style.display = 'block';
    updateScrollControls(); // Update controls to disabled state
    return;
  } else {
    emptyEl.style.display = 'none';
  }
  
  // Extract header row (first row) and data rows
  const headerRow = rows.length > 0 ? rows[0] : [];
  const dataRows = rows.length > 1 ? rows.slice(1) : [];
  
  // Create header mapping (column name to index)
  const headerMap = {};
  headerRow.forEach((colName, idx) => {
    headerMap[colName] = idx;
  });
  
  console.log('CSV标题行:', headerRow);
  console.log('标题映射:', headerMap);
  
  // Build items: convert each CSV row to object with named fields
  allItems = dataRows.map((r, idx) => {
    // Convert array row to object using header names
    const rowObj = {};
    headerRow.forEach((colName, colIdx) => {
      rowObj[colName] = r[colIdx];
    });
    
    return {
      idx,           // Original index (for compatibility)
      row: rowObj,   // Row as object with named fields
      rowArray: r,   // Keep original array for rowId compatibility
      id: rowId(currentFile || 'nofile', r)
    };
  });
  
  // Ensure ratings default
  allItems.forEach(it => {
    if (ratings[it.id] === undefined) ratings[it.id] = 0;
  });
  
  // Apply filter if enabled
  if (filterStarsLevel !== 'all') {
    const targetStars = parseInt(filterStarsLevel);
    allItems = allItems.filter(it => (ratings[it.id] || 0) === targetStars);
    console.log(`筛选${targetStars}星单词，剩余 ${allItems.length} 条`);
  }
  
  // Sort by stars if enabled, otherwise keep original order
  if (sortByStars) {
    allItems.sort((a, b) => (ratings[b.id] || 0) - (ratings[a.id] || 0) || a.idx - b.idx);
    console.log('按星级排序');
  } else {
    // Keep original order (sorted by idx)
    allItems.sort((a, b) => a.idx - b.idx);
    console.log('按原始顺序');
  }
  
  // Reset and render first batch
  currentBatch = 0;
  displayedItems = [];
  cardsEl.innerHTML = '';
  
  const renderTime = performance.now() - startTime;
  console.log(`数据准备完成：${allItems.length} 条数据，耗时 ${renderTime.toFixed(2)}ms`);
  
  // Render first batch
  renderNextBatch();
  
  // Update scroll controls after rendering
  updateScrollControls();
  
  // Restore position if needed
  if (preservePosition && savedRowNum) {
    requestAnimationFrame(() => {
      scrollToRow(savedRowNum, true); // true = immediate, no animation
      console.log(`📍 已恢复到第 ${savedRowNum} 行`);
    });
  }
}

/**
 * Render next batch of cards
 */
function renderNextBatch() {
  if (isLoadingMore) return;
  
  const startTime = performance.now();
  isLoadingMore = true;
  
  const startIdx = currentBatch * BATCH_SIZE;
  const endIdx = Math.min(startIdx + BATCH_SIZE, allItems.length);
  const batchItems = allItems.slice(startIdx, endIdx);
  
  if (batchItems.length === 0) {
    isLoadingMore = false;
    return;
  }
  
  console.log(`渲染批次 ${currentBatch + 1}：第 ${startIdx + 1}-${endIdx} 条`);
  
  // Use DocumentFragment for better performance
  const fragment = document.createDocumentFragment();
  
  batchItems.forEach((it, batchIndex) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.rowIndex = it.idx + 1; // Store original row number (1-based)
    card.setAttribute('data-item-id', it.id); // Store item ID for quick lookup
    
    // Left: content
    const body = document.createElement('div');
    body.className = 'card-body';
    
    // Helper function to get cell value by field name with fallback
    const getCell = (fieldName) => {
      const val = it.row[fieldName];
      if (val === undefined || val === null || val === '') {
        console.warn(`CSV数据异常：第${it.idx + 1}行字段"${fieldName}"数据缺失`);
        return '—';
      }
      return val;
    };
    
    // Row header: row number (left) + first column value (right)
    const header = document.createElement('div');
    header.className = 'row-header';
    
    const rowNum = document.createElement('div');
    rowNum.className = 'row-number';
    // Use 'id' field from CSV if available, otherwise fallback to idx
    const rowId = it.row['id'] !== undefined && it.row['id'] !== null && it.row['id'] !== '' 
      ? it.row['id'] 
      : it.idx;
    rowNum.textContent = `#${parseInt(rowId) + 1}`;
    
    // Sync status indicator
    const syncStatus = document.createElement('span');
    syncStatus.className = 'sync-status unknown';
    syncStatus.textContent = '⚠️';
    syncStatus.title = '检查同步状态中...';
    
    // Check sync status asynchronously (pass card element and item index for range control)
    const syncKey = generateSyncKey(currentFile, rowId);
    const itemIndex = startIdx + batchIndex; // Global index in allItems
    checkSyncStatus(syncKey, syncStatus, it.id, rowId, card, itemIndex);
    
    const colFirst = document.createElement('div');
    colFirst.className = 'col-first';
    colFirst.textContent = getCell('frequency');
    
    header.appendChild(rowNum);
    header.appendChild(syncStatus);
    header.appendChild(colFirst);
    body.appendChild(header);
    
    // Columns: word & phoneticSymbol on same line with 4 spaces
    if (it.row['word'] !== undefined) {
      // Create wrapper for cols23 and speak button
      const cols23Wrapper = document.createElement('div');
      cols23Wrapper.className = 'cols-23-wrapper';
      
      const cols23 = document.createElement('div');
      cols23.className = 'cols-23';
      const word = getCell('word');
      const phoneticSymbol = it.row['phoneticSymbol'] ? getCell('phoneticSymbol') : '';
      cols23.textContent = phoneticSymbol ? `${word}    ${phoneticSymbol}` : word;
      cols23Wrapper.appendChild(cols23);
      
      // Add speech button after cols23 with 4 spaces gap
      if (isSpeechSupported) {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'speak-btn';
        speakBtn.innerHTML = '🔊';
        speakBtn.title = '朗读单词';
        speakBtn.setAttribute('aria-label', '朗读');
        
        speakBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent card click events
          
          try {
            const textToSpeak = getCell('word');
            speakText(textToSpeak, speakBtn);
          } catch (error) {
            console.error('朗读按钮点击处理异常:', error);
          }
        });
        
        cols23Wrapper.appendChild(speakBtn);
      }
      
      body.appendChild(cols23Wrapper);
    }
    
    // Additional fields: definition and sentence
    if (it.row['definition'] !== undefined && it.row['definition'] !== null && it.row['definition'] !== '') {
      const definitionField = document.createElement('div');
      definitionField.className = showDefinition ? 'field field-definition' : 'field field-definition hidden-field';
      definitionField.textContent = getCell('definition');
      body.appendChild(definitionField);
    }
    
    if (it.row['sentence'] !== undefined && it.row['sentence'] !== null && it.row['sentence'] !== '') {
      const sentenceField = document.createElement('div');
      sentenceField.className = showSentence ? 'field field-sentence' : 'field field-sentence hidden-field';
      sentenceField.textContent = getCell('sentence');
      body.appendChild(sentenceField);
    }
    
    // Right: stars
    const side = document.createElement('div');
    side.className = 'card-side';
    
    const starsWrap = document.createElement('div');
    starsWrap.className = 'stars';
    const cur = ratings[it.id] || 0;
    
    for (let s = 1; s <= 5; s++) {
      const sp = document.createElement('span');
      sp.className = 'star' + (s <= cur ? ' active' : '');
      sp.textContent = '★';
      sp.dataset.value = s;
      sp.title = s + ' 星';
      sp.addEventListener('click', () => {
        setRating(it.id, s, rowId, syncStatus);
      });
      starsWrap.appendChild(sp);
    }
    
    // Allow clicking to reset rating
    const zero = document.createElement('div');
    zero.className = 'small';
    zero.style.cursor = 'pointer';
    zero.style.marginTop = '4px';
    zero.textContent = '取消';
    zero.addEventListener('click', () => {
      if (confirm('确认要将该项评分重置为 0 吗？')) {
        // ✅ 传递完整的参数，包括 rowId 和 syncStatus
        setRating(it.id, 0, rowId, syncStatus);
      }
    });
    
    side.appendChild(starsWrap);
    side.appendChild(zero);
    
    card.appendChild(body);
    card.appendChild(side);
    fragment.appendChild(card);
  });
  
  // Add batch items to displayed list
  displayedItems.push(...batchItems);
  
  // Batch insert all cards at once for better performance
  cardsEl.appendChild(fragment);
  
  // Persist ratings immediately
  if (currentFile) saveRatings(currentFile, ratings);
  
  // Performance logging
  const renderTime = performance.now() - startTime;
  console.log(`批次渲染完成：${batchItems.length} 条，总计 ${displayedItems.length}/${allItems.length}，耗时 ${renderTime.toFixed(2)}ms`);
  
  if (renderTime > 200) {
    console.warn(`性能警告：渲染 ${batchItems.length} 条数据耗时超过 200ms`);
  }
  
  // Increment batch counter
  currentBatch++;
  isLoadingMore = false;
  
  // Show loading indicator if more items available
  updateLoadMoreIndicator();
}

/**
 * Update or show "Load More" indicator
 */
function updateLoadMoreIndicator() {
  let loadMoreBtn = document.getElementById('loadMoreBtn');
  
  if (displayedItems.length < allItems.length) {
    if (!loadMoreBtn) {
      loadMoreBtn = document.createElement('div');
      loadMoreBtn.id = 'loadMoreBtn';
      loadMoreBtn.className = 'load-more-btn';
      loadMoreBtn.innerHTML = `
        <button class="btn" onclick="renderNextBatch()">
          加载更多 (${displayedItems.length}/${allItems.length})
        </button>
        <div class="small" style="margin-top: 8px;">
          滚动到底部自动加载
        </div>
      `;
      cardsEl.appendChild(loadMoreBtn);
    } else {
      // Update count
      const btn = loadMoreBtn.querySelector('button');
      if (btn) {
        btn.textContent = `加载更多 (${displayedItems.length}/${allItems.length})`;
      }
    }
  } else {
    // All items loaded, remove button
    if (loadMoreBtn) {
      loadMoreBtn.remove();
    }
  }
}

async function setRating(id, val, rowId, syncStatusElement) {
  const startTime = performance.now();
  console.log('ADLog-Edit: [setRating] ========== 开始 ==========');
  console.log(`ADLog-Edit: [setRating] id = ${id}`);
  console.log(`ADLog-Edit: [setRating] val = ${val}`);
  console.log(`ADLog-Edit: [setRating] rowId = ${rowId}`);
  console.log(`ADLog-Edit: [setRating] currentFile = ${currentFile}`);
  console.log(`⭐ 开始设置星级: id=${id}, val=${val}, rowId=${rowId}`);
  
  // Update local ratings immediately (optimistic update)
  ratings[id] = val;
  console.log(`ADLog-Edit: [setRating] 已更新本地 ratings[${id}] = ${val}`);
  
  // Find the card element to update UI
  const cardElement = document.querySelector(`[data-item-id="${id}"]`);
  
  // Update stars UI immediately (optimistic update)
  if (cardElement) {
    updateCardStars(cardElement, id, val);
    console.log(`ADLog-Edit: [setRating] ✅ UI已立即更新（乐观更新）`);
  }
  
  // Save to localStorage
  if (currentFile) saveRatings(currentFile, ratings);
  
  // Sync to cloud if rowId is provided
  if (rowId !== undefined && currentFile) {
    const syncKey = generateSyncKey(currentFile, rowId);
    console.log(`ADLog-Edit: [setRating] 生成的 syncKey = ${syncKey}`);
    console.log(`🔑 生成同步key: ${syncKey}`);
    
    // Get existing record from cache (no network request)
    console.log(`ADLog-Edit: [setRating] 准备调用 getSyncRecord(${syncKey})...`);
    let record = getSyncRecord(syncKey); // Now synchronous, only checks cache
    console.log(`ADLog-Edit: [setRating] getSyncRecord 返回:`, JSON.stringify(record));
    
    if (!record) {
      console.log(`ADLog-Edit: [setRating] record 为空，创建新记录`);
      console.log(`📝 创建新记录: ${syncKey}`);
      record = {
        key: syncKey,
        stars: val,
        lastViewedRow: null,
        filterLevel: 'all',
        sortByStars: false
      };
      console.log(`ADLog-Edit: [setRating] 新创建的 record:`, JSON.stringify(record));
    } else {
      console.log(`ADLog-Edit: [setRating] record 存在，准备修改 stars`);
      console.log(`ADLog-Edit: [setRating] 修改前 record.stars = ${record.stars}`);
      console.log(`📝 更新现有记录: ${syncKey}`);
      // ✅ 创建新对象，避免修改原始引用
      record = { ...record, stars: val };
      console.log(`ADLog-Edit: [setRating] 修改后 record.stars = ${record.stars}`);
      console.log(`ADLog-Edit: [setRating] 修改后完整 record:`, JSON.stringify(record));
      console.log(`ADLog-Edit: [setRating] ✅ 已创建新对象，避免引用问题`);
    }
    
    // Update to cloud using optimized single record update
    console.log(`ADLog-Edit: [setRating] 准备调用 updateSingleSyncRecord...`);
    console.log(`☁️  开始调用 updateSingleSyncRecord...`);
    const result = await updateSingleSyncRecord(syncKey, record);
    console.log(`ADLog-Edit: [setRating] updateSingleSyncRecord 返回:`, result);
    console.log(`☁️  updateSingleSyncRecord 返回:`, result);
    
    // Update sync status UI
    if (syncStatusElement) {
      if (result.success) {
        syncStatusElement.className = 'sync-status synced';
        syncStatusElement.textContent = 'Synced';
        syncStatusElement.title = '已同步到云端';
        console.log(`✅ 同步状态已更新为 Synced`);
      } else {
        syncStatusElement.className = 'sync-status not-synced';
        syncStatusElement.textContent = 'Local';
        syncStatusElement.title = '未同步到云端';
        console.warn(`⚠️ 同步失败，状态已更新为 Local`);
      }
    }
    
    const elapsed = performance.now() - startTime;
    console.log(`⭐ 星级已更新: ${syncKey} → ${val}星 (耗时: ${elapsed.toFixed(2)}ms)`);
    
    if (elapsed > 200) {
      console.warn(`⚠️ 性能警告：星级更新耗时超过 200ms`);
    }
  } else {
    console.warn(`⚠️ 跳过云端同步: rowId=${rowId}, currentFile=${currentFile}`);
  }
  
  console.log('ADLog-Edit: [setRating] ========== 结束 ==========');
  // ✅ 不再刷新整张表格，只更新对应的 UI 元素
}

// ==================== Theme Management ====================
/**
 * Theme configuration with centralized color management
 */
const themes = {
  gradient: {
    name: '渐变蓝紫',
    background: 'linear-gradient(135deg,#4A90E2,#9013FE)',
    //cardBg: 'rgba(255,255,255,0.95)',//	#1E90FF
    cardBg: '#1E90FF',
    text: 'var(--text-dark)',
    textOnBg: 'var(--text-light)',
    star: '#FFD700',
    syncedIcon: '#4CAF50',
    notSyncedIcon: '#9E9E9E'
  },
  white: {
    name: '纯白色',
    background: '#ffffff',
    cardBg: 'rgba(255,255,255,0.95)',
    text: 'var(--text-dark)',
    textOnBg: 'var(--text-dark)',
    star: '#FFD700',
    syncedIcon: '#4CAF50',
    notSyncedIcon: '#9E9E9E'
  },
  gray: {
    name: '浅灰色',
    background: '#e5e7eb',
    cardBg: 'rgba(255,255,255,0.95)',
    text: 'var(--text-dark)',
    textOnBg: 'var(--text-dark)',
    star: '#FFD700',
    syncedIcon: '#4CAF50',
    notSyncedIcon: '#9E9E9E'
  },
  dark: {
    name: '深色模式',
    background: '#0f172a',
    cardBg: 'rgba(44,44,44,0.95)',
    text: 'var(--text-light)',
    textOnBg: 'var(--text-light)',
    star: '#FFC107',
    syncedIcon: '#66BB6A',
    notSyncedIcon: '#757575'
  },
  kraft: {
    name: '牛皮纸 📦',
    background: '#D7BFA7',
    cardBg: 'rgba(230,209,179,0.95)',
    text: '#3E2F1C',
    textOnBg: '#3E2F1C',
    star: '#C49A6C',
    syncedIcon: '#8B6914',
    notSyncedIcon: '#A89070'
  },
  leaf: {
    name: '泛黄树叶 🍂',
    background: '#F7E8A4',
    cardBg: 'rgba(255,242,199,0.95)',
    text: '#5C4619',
    textOnBg: '#5C4619',
    star: '#D4A017',
    syncedIcon: '#9B7C00',
    notSyncedIcon: '#C4B088'
  }
};

const themeKeys = Object.keys(themes);

function applyTheme(index) {
  const themeKey = themeKeys[index];
  const theme = themes[themeKey];
  
  if (!theme) {
    console.warn(`主题索引 ${index} 无效，使用默认主题`);
    return;
  }
  
  console.log(`应用主题: ${theme.name}`);
  
  // Apply background
  document.body.style.background = theme.background;
  document.body.style.backgroundAttachment = 'fixed';
  document.body.style.color = theme.textOnBg;
  
  // Adjust CSS variables for cards readability
  // Light themes: white(1), gray(2), kraft(4), leaf(5)
  // Dark themes: gradient(0), dark(3)
  const isLight = [1, 2, 4, 5].includes(index);
  document.documentElement.style.setProperty('--card-bg', theme.cardBg);
  document.documentElement.style.setProperty('--muted', isLight ? '#4b5563' : '#9aa4b2');
  
  // Update scroll control colors for light/dark theme
  const scrollControl = document.querySelector('.scroll-control');
  const header = document.querySelector('header');
  const toggleViewBtnEl = document.getElementById('toggleViewBtn');
  const floatingToggleBtnEl = document.getElementById('floatingToggleBtn');
  
  if (isLight) {
    header.style.background = 'rgba(255,255,255,0.85)';
    scrollControl.style.background = 'rgba(255,255,255,0.75)';
    rowInfo.style.color = '#0f172a';
    jumpInput.style.color = '#0f172a';
    jumpInput.style.background = 'rgba(0,0,0,0.05)';
    jumpInput.style.borderColor = 'rgba(0,0,0,0.15)';
    
    // Update toggle buttons for light theme
    if (toggleViewBtnEl) {
      toggleViewBtnEl.style.background = 'rgba(0,0,0,0.08)';
      toggleViewBtnEl.style.color = '#0f172a';
      toggleViewBtnEl.style.borderColor = 'rgba(0,0,0,0.15)';
    }
    if (floatingToggleBtnEl) {
      floatingToggleBtnEl.style.background = 'rgba(255,255,255,0.9)';
      floatingToggleBtnEl.style.color = '#0f172a';
      floatingToggleBtnEl.style.borderColor = 'rgba(0,0,0,0.2)';
    }
  } else {
    header.style.background = 'rgba(0,0,0,0.25)';
    scrollControl.style.background = 'rgba(0,0,0,0.2)';
    rowInfo.style.color = '#fff';
    jumpInput.style.color = '#fff';
    jumpInput.style.background = 'rgba(255,255,255,0.1)';
    jumpInput.style.borderColor = 'rgba(255,255,255,0.2)';
    
    // Update toggle buttons for dark theme
    if (toggleViewBtnEl) {
      toggleViewBtnEl.style.background = 'rgba(255,255,255,0.15)';
      toggleViewBtnEl.style.color = '#fff';
      toggleViewBtnEl.style.borderColor = 'rgba(255,255,255,0.2)';
    }
    if (floatingToggleBtnEl) {
      floatingToggleBtnEl.style.background = 'rgba(0,0,0,0.6)';
      floatingToggleBtnEl.style.color = '#fff';
      floatingToggleBtnEl.style.borderColor = 'rgba(255,255,255,0.3)';
    }
  }
  
  // Force re-render to update text colors in cards
  // ✅ 切换主题时保持当前滚动位置
  renderCards({ preservePosition: true });
  
  // Save theme
  localStorage.setItem('csv_theme_v1', index);
}

// ==================== Event Listeners ====================
// History button
historyBtn.addEventListener('click', e => {
  toggleHistory(historyList.style.display === 'none');
});

document.addEventListener('click', e => {
  if (!e.composedPath().includes(historyList) && e.target !== historyBtn) {
    toggleHistory(false);
  }
});

// Recalculate position on window resize
window.addEventListener('resize', () => {
  if (historyList.style.display === 'block') toggleHistory(true);
});

// Toggle view buttons
if (toggleViewBtn) {
  toggleViewBtn.addEventListener('click', toggleFixedViews);
}

if (floatingToggleBtn) {
  floatingToggleBtn.addEventListener('click', toggleFixedViews);
}

// Theme switchers
sw0.addEventListener('click', () => applyTheme(0));
sw1.addEventListener('click', () => applyTheme(1));
sw2.addEventListener('click', () => applyTheme(2));
sw3.addEventListener('click', () => applyTheme(3));
sw4.addEventListener('click', () => applyTheme(4)); // 牛皮纸 📦
sw5.addEventListener('click', () => applyTheme(5)); // 泛黄树叶 🍂

// ==================== Mobile Layout Fix ====================
/**
 * Adjust scroll-control position on mobile to prevent it from being hidden
 */
function adjustMobileLayout() {
  const header = document.querySelector('header');
  const scrollControl = document.querySelector('.scroll-control');
  const main = document.querySelector('main');
  
  if (!header || !scrollControl || !main) return;
  
  // Only adjust on mobile (viewport width <= 520px)
  const isMobile = window.innerWidth <= 520;
  
  if (isMobile) {
    // Check if header is hidden
    const isHidden = main.classList.contains('expanded');
    
    if (isHidden) {
      // When hidden, let CSS handle margin-top (0)
      scrollControl.style.top = '';
      main.style.marginTop = '';
      console.log(`移动端布局调整：header已隐藏，使用CSS默认值`);
    } else {
      // When visible, calculate dynamic heights
      const headerHeight = header.offsetHeight;
      
      // Set scroll-control top position dynamically
      scrollControl.style.top = `${headerHeight}px`;
      
      // Also adjust main margin-top to account for both fixed elements
      const scrollControlHeight = scrollControl.offsetHeight;
      const totalFixedHeight = headerHeight + scrollControlHeight + 10; // +10 for spacing
      main.style.marginTop = `${totalFixedHeight}px`;
      
      console.log(`移动端布局调整：header高度 ${headerHeight}px，scroll-control高度 ${scrollControlHeight}px，总高度 ${totalFixedHeight}px`);
    }
  } else {
    // Reset to default for desktop/tablet (let CSS handle it)
    scrollControl.style.top = '';
    main.style.marginTop = '';
  }
}

// Adjust on load
window.addEventListener('load', adjustMobileLayout);

// Adjust on resize (with debounce)
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(adjustMobileLayout, 100);
});

// ==================== Field Toggle Functions ====================
/**
 * Toggle definition field visibility
 */
function toggleDefinitionField() {
  showDefinition = !showDefinition;
  
  const toggleCheckbox = document.getElementById('toggleDefinition');
  const label = document.getElementById('definitionLabel');
  
  // Update checkbox state
  if (toggleCheckbox) {
    toggleCheckbox.checked = showDefinition;
  }
  
  // Update label text
  if (label) {
    label.textContent = showDefinition ? '隐藏释义' : '显示释义';
  }
  
  // Toggle all definition fields
  const definitionFields = document.querySelectorAll('.field-definition');
  definitionFields.forEach(field => {
    if (showDefinition) {
      field.classList.remove('hidden-field');
    } else {
      field.classList.add('hidden-field');
    }
  });
  
  // Save state to localStorage
  localStorage.setItem('csv_show_definition_v1', showDefinition);
  
  console.log(`释义字段${showDefinition ? '显示' : '隐藏'}`);
}

/**
 * Toggle sentence field visibility
 */
function toggleSentenceField() {
  showSentence = !showSentence;
  
  const toggleCheckbox = document.getElementById('toggleSentence');
  const label = document.getElementById('sentenceLabel');
  
  // Update checkbox state
  if (toggleCheckbox) {
    toggleCheckbox.checked = showSentence;
  }
  
  // Update label text
  if (label) {
    label.textContent = showSentence ? '隐藏例句' : '显示例句';
  }
  
  // Toggle all sentence fields
  const sentenceFields = document.querySelectorAll('.field-sentence');
  sentenceFields.forEach(field => {
    if (showSentence) {
      field.classList.remove('hidden-field');
    } else {
      field.classList.add('hidden-field');
    }
  });
  
  // Save state to localStorage
  localStorage.setItem('csv_show_sentence_v1', showSentence);
  
  console.log(`例句字段${showSentence ? '显示' : '隐藏'}`);
}

/**
 * Update global settings to JSONBin.io
 * This stores file-level settings like filterLevel and sortByStars
 */
async function updateGlobalSettings() {
  if (!currentFile) return;
  
  const globalKey = `${currentFile.replace('.csv', '')}_settings`;
  const settings = {
    key: globalKey,
    filterLevel: filterStarsLevel,
    sortByStars: sortByStars,
    lastUpdated: new Date().toISOString()
  };
  
  await updateSyncRecord(globalKey, settings);
  console.log(`💾 全局设置已同步: ${globalKey}`, settings);
}

/**
 * Restore global settings from JSONBin.io or localStorage
 */
async function restoreGlobalSettings() {
  // Try localStorage first
  const savedFilterLevel = localStorage.getItem('csv_filter_level_v1');
  const savedSortByStars = localStorage.getItem('csv_sort_by_stars_v1');
  
  if (savedFilterLevel !== null) {
    filterStarsLevel = savedFilterLevel;
    const filterSelect = document.getElementById('filterStars');
    if (filterSelect) {
      filterSelect.value = filterStarsLevel;
    }
    console.log(`恢复筛选级别: ${filterStarsLevel}`);
  }
  
  if (savedSortByStars !== null) {
    sortByStars = savedSortByStars === 'true';
    const toggleSortCheckbox = document.getElementById('toggleSortByStars');
    const sortLabel = document.getElementById('sortLabel');
    if (toggleSortCheckbox) {
      toggleSortCheckbox.checked = sortByStars;
    }
    if (sortLabel) {
      sortLabel.textContent = sortByStars ? '原始顺序' : '星级排序';
    }
    console.log(`恢复排序设置: ${sortByStars ? '按星级' : '按原始'}`);
  }
  
  // Try to fetch from cloud if currentFile exists
  if (currentFile) {
    const globalKey = `${currentFile.replace('.csv', '')}_settings`;
    const cloudSettings = await getSyncRecord(globalKey);
    
    if (cloudSettings) {
      // Cloud settings override local settings
      if (cloudSettings.filterLevel !== undefined) {
        filterStarsLevel = cloudSettings.filterLevel;
        const filterSelect = document.getElementById('filterStars');
        if (filterSelect) {
          filterSelect.value = filterStarsLevel;
        }
      }
      
      if (cloudSettings.sortByStars !== undefined) {
        sortByStars = cloudSettings.sortByStars;
        const toggleSortCheckbox = document.getElementById('toggleSortByStars');
        const sortLabel = document.getElementById('sortLabel');
        if (toggleSortCheckbox) {
          toggleSortCheckbox.checked = sortByStars;
        }
        if (sortLabel) {
          sortLabel.textContent = sortByStars ? '原始顺序' : '星级排序';
        }
      }
      
      console.log(`☁️ 从云端恢复设置: ${globalKey}`, cloudSettings);
    }
  }
}

/**
 * Restore field visibility state from localStorage
 */
function restoreFieldVisibilityState() {
  // Restore definition state
  const savedDefinitionState = localStorage.getItem('csv_show_definition_v1');
  if (savedDefinitionState !== null) {
    showDefinition = savedDefinitionState === 'true';
    
    const toggleCheckbox = document.getElementById('toggleDefinition');
    const label = document.getElementById('definitionLabel');
    
    if (toggleCheckbox) {
      toggleCheckbox.checked = showDefinition;
    }
    
    if (label) {
      label.textContent = showDefinition ? '隐藏释义' : '显示释义';
    }
    
    console.log(`恢复释义状态: ${showDefinition ? '显示' : '隐藏'}`);
  }
  
  // Restore sentence state
  const savedSentenceState = localStorage.getItem('csv_show_sentence_v1');
  if (savedSentenceState !== null) {
    showSentence = savedSentenceState === 'true';
    
    const toggleCheckbox = document.getElementById('toggleSentence');
    const label = document.getElementById('sentenceLabel');
    
    if (toggleCheckbox) {
      toggleCheckbox.checked = showSentence;
    }
    
    if (label) {
      label.textContent = showSentence ? '隐藏例句' : '显示例句';
    }
    
    console.log(`恢复例句状态: ${showSentence ? '显示' : '隐藏'}`);
  }
}

// ==================== Initialization ====================
// Check speech synthesis support
checkSpeechSupport();

// Restore saved view state
restoreViewState();

// Restore field visibility state
restoreFieldVisibilityState();

// Restore global settings (filter and sort)
restoreGlobalSettings();

// Initial mobile layout adjustment
adjustMobileLayout();

// Field toggle event listeners
const toggleDefinitionCheckbox = document.getElementById('toggleDefinition');
const toggleSentenceCheckbox = document.getElementById('toggleSentence');

if (toggleDefinitionCheckbox) {
  toggleDefinitionCheckbox.addEventListener('change', toggleDefinitionField);
}

if (toggleSentenceCheckbox) {
  toggleSentenceCheckbox.addEventListener('change', toggleSentenceField);
}

// Filter and sort event listeners
const filterStarsSelect = document.getElementById('filterStars');
const toggleSortByStarsCheckbox = document.getElementById('toggleSortByStars');

if (filterStarsSelect) {
  filterStarsSelect.addEventListener('change', (e) => {
    filterStarsLevel = e.target.value;
    console.log(`筛选级别变更: ${filterStarsLevel}`);
    
    // Save to localStorage
    localStorage.setItem('csv_filter_level_v1', filterStarsLevel);
    
    // Sync to cloud if currentFile exists
    if (currentFile) {
      updateGlobalSettings();
    }
    
    // Re-render cards
    // ✅ 筛选时保持当前滚动位置
    renderCards({ preservePosition: true });
  });
}

if (toggleSortByStarsCheckbox) {
  toggleSortByStarsCheckbox.addEventListener('change', (e) => {
    sortByStars = e.target.checked;
    console.log(`星级排序: ${sortByStars ? '开启' : '关闭'}`);
    
    // Update label
    const sortLabel = document.getElementById('sortLabel');
    if (sortLabel) {
      sortLabel.textContent = sortByStars ? '原始顺序' : '星级排序';
    }
    
    // Save to localStorage
    localStorage.setItem('csv_sort_by_stars_v1', sortByStars);
    
    // Sync to cloud if currentFile exists
    if (currentFile) {
      updateGlobalSettings();
    }
    
    // Re-render cards
    // ✅ 排序时保持当前滚动位置
    renderCards({ preservePosition: true });
  });
}

// Load last opened file if exists
(function init() {
  const h = loadHistory();
  if (h && h.length) {
    const last = h[h.length - 1];
    const data = loadCsv(last);
    if (data) {
      loadFile(last, data);
    }
  }
})();

// Restore saved theme
const savedTheme = localStorage.getItem('csv_theme_v1');
if (savedTheme !== null) {
  applyTheme(Number(savedTheme));
}

