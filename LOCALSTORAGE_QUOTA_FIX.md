# localStorage 配额超限问题修复

## 🐛 问题描述

导入大型CSV文件（如 10,000 行数据）时出现错误：

```
Uncaught (in promise) QuotaExceededError: Failed to execute 'setItem' on 'Storage': 
Setting the value of 'csv_data_ten1000Words.csv' exceeded the quota.
```

## 🔍 根本原因

### localStorage 配额限制

| 浏览器 | 配额限制 |
|-------|---------|
| Chrome | 5-10 MB |
| Firefox | 10 MB |
| Safari | 5 MB |
| Edge | 10 MB |

### 问题代码

```javascript
// 旧代码：直接保存整个CSV数据到localStorage
function saveCsv(name, rows) {
  saveJSON('csv_data_' + name, rows);  // ❌ 大文件会超出配额
}

// 文件加载时
fileInput.addEventListener('change', async e => {
  const parsed = parseCSV(text);
  saveCsv(name, parsed);  // ❌ 10,000行 ≈ 5-10 MB，超出配额
});
```

### 数据大小估算

```javascript
// 10,000 行英语单词数据
// 每行约 100-150 字节
// 总计：~1-1.5 MB（原始数据）
// JSON.stringify 后：~2-3 MB
// 加上其他数据（评分等）：~5-10 MB
// 结果：超出 localStorage 配额 ❌
```

## ✅ 解决方案

### 策略

1. **小文件**（< 1MB）：继续保存到 localStorage
2. **大文件**（≥ 1MB）：只保存文件名到历史记录，不保存内容
3. **错误处理**：捕获 QuotaExceededError，提供友好提示

### 修复代码

#### 1. 智能保存策略

```javascript
function saveCsv(name, rows) {
  try {
    // 估算数据大小
    const dataSize = JSON.stringify(rows).length;
    
    if (dataSize < 1000000) { // < 1MB
      // 小文件：保存到 localStorage
      saveJSON('csv_data_' + name, rows);
      console.log(`CSV内容已保存到本地存储（大小: ${(dataSize / 1024).toFixed(2)} KB）`);
    } else {
      // 大文件：跳过保存
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
```

#### 2. 友好的历史加载提示

```javascript
function loadFromHistory(name) {
  const data = loadCsv(name);
  if (!data) {
    alert(`文件"${name}"的内容未保存在本地存储中（可能因文件过大）。\n\n请点击"选择 CSV"按钮重新选择该文件。`);
    return;
  }
  loadFile(name, data);
}
```

#### 3. 评分保存错误处理

```javascript
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
```

#### 4. 通用保存函数错误处理

```javascript
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
```

## 📊 修复效果

### 文件大小处理

| 文件大小 | 处理策略 | 效果 |
|---------|---------|------|
| **< 1MB** | 保存到 localStorage | ✅ 可从历史快速加载 |
| **≥ 1MB** | 仅保存文件名 | ✅ 不会超出配额 |
| **超出配额** | 捕获错误 | ✅ 友好提示，不会崩溃 |

### 用户体验

#### 小文件场景（< 1000 行）

```
用户操作：
1. 选择 small.csv（500 行）
2. 编辑评分
3. 关闭浏览器
4. 重新打开，点击历史记录

结果：
✅ 数据已保存，立即加载
✅ 评分已保存
✅ 无需重新选择文件
```

#### 大文件场景（≥ 10000 行）

```
用户操作：
1. 选择 large.csv（10,000 行）
2. 控制台显示：
   "CSV文件过大（5.2 MB），跳过本地存储。请重新选择文件加载数据。"
3. 编辑评分（评分仍然保存）
4. 关闭浏览器
5. 重新打开，点击历史记录

结果：
⚠️ 弹出提示：
   "文件"large.csv"的内容未保存在本地存储中（可能因文件过大）。
   
   请点击"选择 CSV"按钮重新选择该文件。"
✅ 评分已保存（可用）
✅ 需要重新选择文件
```

## 🎯 数据保存优先级

### 1. 评分数据（高优先级）

```javascript
// 评分数据很小（通常 < 100KB）
saveRatings(name, ratings);
// ✅ 始终尝试保存
```

### 2. 历史记录（高优先级）

```javascript
// 仅保存文件名列表（< 1KB）
addHistory(name);
// ✅ 始终保存
```

### 3. CSV 内容（低优先级）

```javascript
// CSV 内容可能很大（1-10 MB）
saveCsv(name, rows);
// ⚠️ 仅在文件 < 1MB 时保存
```

### 4. 其他设置（中优先级）

```javascript
// 主题、视图状态等（< 1KB）
localStorage.setItem('csv_theme_v1', index);
localStorage.setItem('csv_views_hidden_v1', isViewsHidden);
// ✅ 始终保存
```

## 🔧 清理 localStorage

### 查看当前使用情况

```javascript
// 在浏览器控制台执行
function getLocalStorageSize() {
  let total = 0;
  for (let key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      total += localStorage[key].length + key.length;
    }
  }
  return (total / 1024).toFixed(2) + ' KB';
}

console.log('localStorage 使用量:', getLocalStorageSize());

// 查看各个键的大小
for (let key in localStorage) {
  if (localStorage.hasOwnProperty(key)) {
    const size = (localStorage[key].length / 1024).toFixed(2);
    console.log(`${key}: ${size} KB`);
  }
}
```

### 清理旧的 CSV 数据

```javascript
// 在浏览器控制台执行
function cleanOldCsvData() {
  let cleaned = 0;
  for (let key in localStorage) {
    if (key.startsWith('csv_data_')) {
      localStorage.removeItem(key);
      cleaned++;
      console.log(`已删除: ${key}`);
    }
  }
  console.log(`总共清理了 ${cleaned} 个CSV数据`);
}

cleanOldCsvData();
```

### 完全重置

```javascript
// 在浏览器控制台执行（⚠️ 会删除所有数据）
localStorage.clear();
console.log('localStorage 已完全清空');
```

## 📱 浏览器兼容性

| 浏览器 | QuotaExceededError 支持 | 行为 |
|-------|------------------------|------|
| Chrome ≥ 100 | ✅ | 正确捕获和处理 |
| Safari ≥ 15 | ✅ | 正确捕获和处理 |
| Edge ≥ 100 | ✅ | 正确捕获和处理 |
| Firefox ≥ 100 | ✅ | 正确捕获和处理 |

## 🎓 最佳实践

### 1. 不要在 localStorage 中存储大数据

```javascript
// ❌ 不好
localStorage.setItem('bigData', JSON.stringify(largeArray));

// ✅ 好
if (dataSize < 1000000) {
  localStorage.setItem('data', JSON.stringify(smallArray));
}
```

### 2. 始终使用 try-catch

```javascript
// ❌ 不好
localStorage.setItem(key, value);

// ✅ 好
try {
  localStorage.setItem(key, value);
} catch (e) {
  if (e.name === 'QuotaExceededError') {
    // 处理配额超限
  }
}
```

### 3. 提供降级方案

```javascript
// ✅ 好
try {
  localStorage.setItem('data', value);
} catch (e) {
  // 降级：仅保存到内存
  tempStorage[key] = value;
  console.warn('使用临时存储（页面刷新后丢失）');
}
```

### 4. 估算数据大小

```javascript
// ✅ 好
const dataSize = JSON.stringify(data).length;
if (dataSize < 1000000) { // 1MB
  localStorage.setItem('data', JSON.stringify(data));
} else {
  console.warn(`数据过大: ${(dataSize / 1024 / 1024).toFixed(2)} MB`);
}
```

## ✅ 验证清单

- [x] 小文件（< 1MB）可正常保存
- [x] 大文件（≥ 1MB）跳过保存，不报错
- [x] QuotaExceededError 被正确捕获
- [x] 用户收到友好的错误提示
- [x] 评分数据有错误处理
- [x] 历史记录仍然工作
- [x] 控制台日志清晰
- [x] 无 lint 错误

## 🎉 总结

### 核心改进

1. **智能保存**：小文件保存，大文件跳过
2. **错误处理**：捕获 QuotaExceededError
3. **友好提示**：告知用户为什么需要重新选择文件
4. **数据优先级**：确保评分等重要数据优先保存

### 用户影响

- ✅ **小文件**（< 1000 行）：体验无变化
- ⚠️ **大文件**（≥ 10000 行）：需要每次重新选择文件，但评分仍然保存
- ✅ **所有文件**：不再出现崩溃错误

### 建议

对于经常使用大文件的用户：
1. 将大文件拆分为多个小文件
2. 定期清理浏览器 localStorage
3. 使用浏览器的"导出评分"功能（如果有）

现在应用可以优雅地处理任意大小的 CSV 文件，不会因为 localStorage 配额限制而崩溃！🎉

