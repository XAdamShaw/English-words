# 语音朗读功能说明

## 功能概述

基于浏览器内置 SpeechSynthesis API 实现的英文单词朗读功能，无需第三方依赖，支持现代主流浏览器。

## 技术实现

### 架构设计

```
script.js
├── checkSpeechSupport()      # 检测浏览器支持
├── speakText(text, button)   # 核心朗读函数
└── stopSpeech()               # 停止朗读
```

### 代码位置

1. **script.js (行 87-199)**
   - 语音合成函数封装
   - 兼容性检测
   - 异常处理

2. **script.js (行 714-734)**
   - 在 `cols23` 元素后插入朗读按钮
   - 绑定点击事件处理器

3. **style.css (行 525-574)**
   - 朗读按钮样式
   - 动画效果
   - 响应式适配

## 功能特性

### ✅ 核心功能

- **智能降级**：不支持的浏览器自动隐藏按钮
- **防重叠播放**：自动停止之前的朗读
- **视觉反馈**：朗读中按钮脉冲动画
- **性能监测**：启动时间 < 100ms（控制台可查看）
- **异常捕获**：所有错误通过 try-catch 捕获并记录

### 🎯 交互细节

1. **按钮状态**
   - 默认：半透明蓝色边框
   - Hover：加深背景，轻微放大（scale 1.05）
   - Active：缩小效果（scale 0.95）
   - Reading：脉冲动画，蓝色高亮

2. **朗读配置**
   ```javascript
   utterance.lang = 'en-US';     // 美式英语
   utterance.rate = 0.9;         // 语速 (0.9x)
   utterance.pitch = 1.0;        // 音调 (标准)
   utterance.volume = 1.0;       // 音量 (100%)
   ```

3. **输入验证**
   - 自动过滤空字符串
   - 忽略占位符 "—"
   - 非字符串输入跳过

## 使用方法

### 用户操作

1. 上传包含单词的 CSV 文件
2. 找到卡片中第二列（单词列）下方的 🔊 按钮
3. 点击按钮即可听到单词发音
4. 再次点击可重新播放

### 开发者集成

**调用朗读函数**
```javascript
// 基础用法
speakText('abandon');

// 带视觉反馈
const button = document.querySelector('.speak-btn');
speakText('abandon', button);

// 停止朗读
stopSpeech();
```

**检测支持**
```javascript
if (isSpeechSupported) {
  // 显示朗读按钮
} else {
  // 隐藏或禁用按钮
}
```

## 浏览器兼容性

| 浏览器 | 最低版本 | 状态 |
|--------|---------|------|
| Chrome | ≥ 100   | ✅ 完全支持 |
| Edge   | ≥ 100   | ✅ 完全支持 |
| Safari | ≥ 15    | ✅ 完全支持 |
| Firefox| ≥ 100   | ✅ 完全支持 |

### 不支持的浏览器

- Internet Explorer（任何版本）
- 老旧移动浏览器（< 2020年）

## 性能指标

### 响应时间

- **目标**：< 100ms
- **实际**：通常 20-50ms（现代浏览器）
- **监测**：控制台自动记录并警告超标

### 控制台输出示例

```
✅ SpeechSynthesis API 已支持
✅ 语音播放已启动，响应时间 42.35ms
✅ 语音播放已结束

⚠️ 响应时间警告：启动耗时 125.67ms，超过 100ms 目标
⚠️ 无有效内容可朗读
❌ 语音播放错误: network
```

## 代码规范

### 函数签名

```javascript
/**
 * Speak text using SpeechSynthesis API
 * @param {string} text - Text to speak
 * @param {HTMLElement} button - Button element for visual feedback (optional)
 */
function speakText(text, button = null)
```

### 错误处理

所有可能抛出异常的代码都包含在 try-catch 块中：

```javascript
try {
  const textToSpeak = getCell(1);
  speakText(textToSpeak, speakBtn);
} catch (error) {
  console.error('朗读按钮点击处理异常:', error);
}
```

### 事件处理

```javascript
utterance.onstart = () => { /* 启动回调 */ }
utterance.onend = () => { /* 结束回调 */ }
utterance.onerror = (event) => { /* 错误处理 */ }
```

## 样式定制

### CSS 变量可自定义

```css
/* 修改按钮颜色 */
.speak-btn {
  background: rgba(36, 107, 253, 0.1);  /* 背景色 */
  border: 1px solid rgba(36, 107, 253, 0.3);  /* 边框色 */
}

/* 修改动画速度 */
.speak-btn.reading {
  animation: pulse 1.5s ease-in-out infinite;  /* 动画时长 */
}
```

### 响应式断点

- **820px**: 缩小按钮 (14px)
- **520px**: 继承 820px 样式

## 已知限制

1. **网络依赖**：部分浏览器需要网络连接下载语音包
2. **语音质量**：取决于操作系统内置 TTS 引擎
3. **多语言**：当前配置为英语（可修改 `utterance.lang`）
4. **并发限制**：同时只能播放一个语音

## 扩展建议

### 添加语速控制

```javascript
// 在 HTML 中添加滑块
<input type="range" id="rateControl" min="0.5" max="2" step="0.1" value="0.9">

// 在 speakText 函数中使用
const rate = document.getElementById('rateControl').value;
utterance.rate = parseFloat(rate);
```

### 支持多语言

```javascript
// 检测文本语言并自动切换
function detectLanguage(text) {
  // 简单的中英文检测
  return /[\u4e00-\u9fa5]/.test(text) ? 'zh-CN' : 'en-US';
}

utterance.lang = detectLanguage(text);
```

### 添加暂停/继续功能

```javascript
function pauseSpeech() {
  if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause();
  }
}

function resumeSpeech() {
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }
}
```

## 调试技巧

### 检查 API 可用性

```javascript
console.log('SpeechSynthesis:', window.speechSynthesis);
console.log('Voices:', window.speechSynthesis.getVoices());
```

### 测试语音

```javascript
// 在浏览器控制台直接测试
const utterance = new SpeechSynthesisUtterance('Hello World');
speechSynthesis.speak(utterance);
```

### 监听所有事件

```javascript
utterance.onstart = () => console.log('Started');
utterance.onend = () => console.log('Ended');
utterance.onpause = () => console.log('Paused');
utterance.onresume = () => console.log('Resumed');
utterance.onerror = (e) => console.error('Error:', e);
utterance.onboundary = (e) => console.log('Boundary:', e);
```

## 故障排查

| 问题 | 可能原因 | 解决方法 |
|-----|---------|----------|
| 按钮不显示 | 浏览器不支持 | 升级浏览器或使用 Chrome |
| 无声音 | 系统音量关闭 | 检查系统音量设置 |
| 点击无反应 | JavaScript 错误 | 查看控制台错误信息 |
| 发音不准确 | 系统语音质量 | 安装更好的 TTS 语音包 |

## 更新日志

### v1.0.0 (2025-11-03)
- ✅ 初始版本
- ✅ 基础朗读功能
- ✅ 视觉反馈动画
- ✅ 兼容性检测
- ✅ 性能监测
- ✅ 完整异常处理

## License

MIT - 与主项目保持一致

