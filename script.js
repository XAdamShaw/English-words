// ==================== Storage Helpers ====================
const HISTORY_KEY = 'csv_history_v2';

function saveJSON(k, v) {
  localStorage.setItem(k, JSON.stringify(v));
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
  saveJSON('csv_data_' + name, rows);
}

function loadCsv(name) {
  return loadJSON('csv_data_' + name, null);
}

function saveRatings(name, ratings) {
  saveJSON('csv_ratings_' + name, ratings);
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
    alert('历史中未保存该文件的内容，请重新上传');
    return;
  }
  loadFile(name, data);
}

function loadFile(name, data) {
  currentFile = name;
  rows = data;
  ratings = loadRatings(name) || {};
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
    const targetBatchIndex = Math.floor((rowNum - 1) / BATCH_SIZE);
    const currentLastBatch = Math.floor((displayedItems.length - 1) / BATCH_SIZE);
    
    console.log(`目标行 ${rowNum} 在批次 ${targetBatchIndex + 1}，当前已加载到批次 ${currentLastBatch + 1}`);
    
    // Strategy: If jumping far ahead, clear and render target batch directly
    // This avoids rendering thousands of intermediate items
    if (targetBatchIndex > currentBatch + 5) {
      console.log(`远距离跳转：清空当前显示，直接渲染目标批次附近`);
      
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
    } else {
      // Close range: render sequentially
      const targetBatchCount = targetBatchIndex + 1;
      while (currentBatch < targetBatchCount && displayedItems.length < allItems.length) {
        renderNextBatch();
      }
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
function renderCards() {
  const startTime = performance.now();
  
  if (!rows || !rows.length) {
    cardsEl.innerHTML = '';
    emptyEl.style.display = 'block';
    updateScrollControls(); // Update controls to disabled state
    return;
  } else {
    emptyEl.style.display = 'none';
  }
  
  // Skip first row (header) if exists
  const dataRows = rows.length > 1 ? rows.slice(1) : rows;
  
  // Build items: for each CSV row -> card
  allItems = dataRows.map((r, idx) => ({
    idx,
    row: r,
    id: rowId(currentFile || 'nofile', r)
  }));
  
  // Ensure ratings default
  allItems.forEach(it => {
    if (ratings[it.id] === undefined) ratings[it.id] = 0;
  });
  
  // Sort by rating desc, then idx
  allItems.sort((a, b) => (ratings[b.id] || 0) - (ratings[a.id] || 0) || a.idx - b.idx);
  
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
  
  batchItems.forEach(it => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.rowIndex = it.idx + 1; // Store original row number (1-based)
    
    // Left: content
    const body = document.createElement('div');
    body.className = 'card-body';
    
    // Helper function to get cell value with fallback
    const getCell = (index) => {
      const val = it.row[index];
      if (val === undefined || val === null || val === '') {
        console.warn(`CSV数据异常：第${it.idx + 1}行第${index + 1}列数据缺失`);
        return '—';
      }
      return val;
    };
    
    // Row header: row number (left) + first column value (right)
    const header = document.createElement('div');
    header.className = 'row-header';
    
    const rowNum = document.createElement('div');
    rowNum.className = 'row-number';
    rowNum.textContent = `#${it.idx + 1}`;
    
    const colFirst = document.createElement('div');
    colFirst.className = 'col-first';
    colFirst.textContent = getCell(0);
    
    header.appendChild(rowNum);
    header.appendChild(colFirst);
    body.appendChild(header);
    
    // Columns 2 & 3 on same line with 4 spaces
    if (it.row.length > 1) {
      // Create wrapper for cols23 and speak button
      const cols23Wrapper = document.createElement('div');
      cols23Wrapper.className = 'cols-23-wrapper';
      
      const cols23 = document.createElement('div');
      cols23.className = 'cols-23';
      const col2 = getCell(1);
      const col3 = it.row.length > 2 ? getCell(2) : '';
      cols23.textContent = col3 ? `${col2}    ${col3}` : col2;
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
            const textToSpeak = getCell(1);
            speakText(textToSpeak, speakBtn);
          } catch (error) {
            console.error('朗读按钮点击处理异常:', error);
          }
        });
        
        cols23Wrapper.appendChild(speakBtn);
      }
      
      body.appendChild(cols23Wrapper);
    }
    
    // Remaining columns (4+)
    for (let i = 3; i < it.row.length; i++) {
      const fld = document.createElement('div');
      fld.className = 'field';
      fld.textContent = getCell(i);
      body.appendChild(fld);
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
        setRating(it.id, s);
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
        setRating(it.id, 0);
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

function setRating(id, val) {
  ratings[id] = val;
  if (currentFile) saveRatings(currentFile, ratings);
  renderCards();
}

// ==================== Theme Management ====================
function applyTheme(index) {
  if (index === 0) {
    document.body.style.background = 'linear-gradient(135deg,#4A90E2,#9013FE)';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.color = 'var(--text-light)';
  }
  if (index === 1) {
    document.body.style.background = '#ffffff';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.color = 'var(--text-dark)';
  }
  if (index === 2) {
    document.body.style.background = '#e5e7eb';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.color = 'var(--text-dark)';
  }
  if (index === 3) {
    document.body.style.background = '#0f172a';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.color = 'var(--text-light)';
  }
  
  // Adjust CSS variables for cards readability
  const isLight = (index === 1 || index === 2);
  document.documentElement.style.setProperty('--card-bg', isLight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.36)');
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
  renderCards();
  
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

// ==================== Initialization ====================
// Check speech synthesis support
checkSpeechSupport();

// Restore saved view state
restoreViewState();

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

