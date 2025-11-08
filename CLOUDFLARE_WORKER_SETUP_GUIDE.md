# Cloudflare Worker 配置完整指南

## 📋 目标

创建一个 Cloudflare Worker 代理服务，解决浏览器访问 JSONBin.io 的 CORS 问题。

**预计时间**：10-15分钟

---

## 第一步：注册 Cloudflare 账号

### 1.1 打开注册页面

在浏览器中访问：
```
https://dash.cloudflare.com/sign-up
```

### 1.2 填写注册信息

你会看到一个注册表单，需要填写以下信息：

```
📧 Email Address (邮箱地址)
   - 输入你的邮箱，例如：yourname@gmail.com
   
🔒 Password (密码)
   - 输入一个强密码
   - 至少8个字符
   - 建议包含大小写字母、数字、特殊符号
   
✅ I have read and agree to Cloudflare's Terms of Service and Privacy Policy
   - 勾选这个复选框（同意条款）
```

**填写示例**：
```
Email: adam.shaw@example.com
Password: MySecurePass123!
☑️ I have read and agree...
```

### 1.3 点击 "Sign Up" 按钮

- 找到表单底部的蓝色 "Sign Up" 按钮
- 点击它

### 1.4 验证邮箱

1. **查看邮箱**
   - 打开你刚才填写的邮箱
   - 查找来自 Cloudflare 的邮件
   - 邮件主题类似："Verify your email address"

2. **点击验证链接**
   - 打开邮件
   - 找到蓝色按钮 "Verify Email"
   - 点击它

3. **完成验证**
   - 浏览器会自动跳转到 Cloudflare Dashboard
   - 你会看到 "Email verified" 的提示

---

## 第二步：登录并进入 Dashboard

### 2.1 登录（如果需要）

如果浏览器跳转后需要登录：
1. 输入你的邮箱
2. 输入你的密码
3. 点击 "Log In"

### 2.2 了解 Dashboard 界面

登录成功后，你会看到 Cloudflare 的主控制台（Dashboard），左侧有一个菜单栏：

```
☰ 菜单（左上角）
├── 🏠 Home
├── 🌐 Websites
├── 📧 Email Routing
├── ⚙️ Workers & Pages  ← 我们要用这个
├── 🔐 Zero Trust
├── ...
```

---

## 第三步：创建 Worker

### 3.1 进入 Workers 页面

1. **点击左侧菜单**
   - 找到 "⚙️ Workers & Pages"
   - 点击它

2. **查看 Workers 页面**
   你会看到一个类似这样的页面：
   ```
   ┌────────────────────────────────────────┐
   │  Workers & Pages                       │
   ├────────────────────────────────────────┤
   │                                        │
   │  Get started with Workers              │
   │                                        │
   │  [Create Application] 按钮             │
   │                                        │
   └────────────────────────────────────────┘
   ```

### 3.2 创建第一个 Worker

#### 选项 A：如果是第一次使用（推荐）

1. **点击 "Create Application" 按钮**
   - 这是一个蓝色的大按钮
   - 位于页面中央

2. **选择 Worker 类型**
   你会看到两个选项：
   ```
   ┌─────────────────┐  ┌─────────────────┐
   │   Workers       │  │   Pages         │
   │                 │  │                 │
   │  [Create]       │  │  [Create]       │
   └─────────────────┘  └─────────────────┘
   ```
   
   - **点击左边的 "Workers" 下的 "Create" 按钮**

3. **选择模板**
   你会看到多个模板选项：
   ```
   ┌──────────────────────────────────────┐
   │  Select a starter                    │
   ├──────────────────────────────────────┤
   │  ○ Hello World                       │
   │  ○ HTTP Handler                      │← 选择这个
   │  ○ Scheduled Handler                 │
   │  ○ ...                               │
   └──────────────────────────────────────┘
   ```
   
   - **选择 "HTTP Handler"**（处理 HTTP 请求）
   - 点击 "Continue to project details"

#### 选项 B：如果已经有其他 Workers

1. **点击右上角的 "Create a Service" 或 "Create" 按钮**

2. **会直接进入配置页面**

### 3.3 配置 Worker 名称

你会看到一个配置表单：

```
┌────────────────────────────────────────┐
│  Create a Worker                       │
├────────────────────────────────────────┤
│                                        │
│  Worker name                           │
│  ┌──────────────────────────────────┐ │
│  │ jsonbin-proxy                    │ │← 输入这个名字
│  └──────────────────────────────────┘ │
│                                        │
│  Your worker will be available at:     │
│  https://jsonbin-proxy.YOUR_ID.workers.dev
│                                        │
│  [Deploy] 按钮                         │
│                                        │
└────────────────────────────────────────┘
```

**填写信息**：
1. **Worker name**：输入 `jsonbin-proxy`
   - 可以用其他名字，但建议用这个
   - 只能包含小写字母、数字、连字符
   
2. **查看 URL**
   - 下方会显示你的 Worker URL
   - 类似：`https://jsonbin-proxy.YOUR_USERNAME.workers.dev`
   - **⚠️ 重要：记住这个 URL，后面会用到**

3. **点击 "Deploy" 按钮**
   - 这是一个蓝色按钮
   - 位于页面底部

### 3.4 部署成功

部署后，你会看到一个成功页面：
```
┌────────────────────────────────────────┐
│  ✅ Success!                           │
│                                        │
│  Your worker has been deployed to:     │
│  https://jsonbin-proxy.xxx.workers.dev │
│                                        │
│  [Edit code] 按钮                      │
│  [View]      按钮                      │
│                                        │
└────────────────────────────────────────┘
```

---

## 第四步：编辑 Worker 代码

### 4.1 进入代码编辑器

1. **点击 "Edit code" 按钮**
   - 或者点击 "Quick Edit"
   
2. **等待编辑器加载**
   你会看到一个在线代码编辑器，类似这样：
   ```
   ┌─────────────────────────────────────────┐
   │  worker.js          [Save] [Test]       │
   ├─────────────────────────────────────────┤
   │ 1  export default {                     │
   │ 2    async fetch(request, env, ctx) {   │
   │ 3      return new Response("Hello");    │
   │ 4    }                                  │
   │ 5  }                                    │
   │                                         │
   │                                         │
   └─────────────────────────────────────────┘
   ```

### 4.2 删除默认代码

1. **全选代码**
   - Windows: `Ctrl + A`
   - Mac: `Command + A`

2. **删除**
   - 按 `Delete` 或 `Backspace` 键
   - 编辑器现在应该是空白的

### 4.3 粘贴新代码

1. **复制下面的完整代码**：

```javascript
/**
 * Cloudflare Worker - JSONBin.io Proxy
 * 用于解决 CORS 问题
 */

// ==================== 配置区域（需要修改） ====================

// JSONBin.io 配置
const JSONBIN_API_KEY = '$2a$10$aykcTuMUyEz67pg05agzx.dqAWKAiMzRwI6EZZPjKbabxR77epyWC';
const JSONBIN_BIN_ID = '690cab8c43b1c97be99cd080';
const JSONBIN_BASE_URL = 'https://api.jsonbin.io/v3';

// 允许的来源（白名单）
// ⚠️ 重要：请修改为你的 GitHub Pages 域名
const ALLOWED_ORIGINS = [
  'https://xadamshaw.github.io',  // ← 修改为你的域名
  'http://localhost:8000',        // 本地测试
  'http://localhost:3000',        // 本地测试
  'http://127.0.0.1:8000'         // 本地测试
];

// ==================== 代码区域（无需修改） ====================

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return handleCORS(request);
  }

  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  // 检查来源是否在白名单中
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Origin not allowed', { 
      status: 403,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }

  try {
    const method = request.method;
    const path = url.pathname;

    // 确定 JSONBin.io 的目标 URL
    let jsonbinUrl;
    if (path === '/latest' || path === '/') {
      // GET: 获取最新数据
      jsonbinUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}/latest`;
    } else if (path === '/update') {
      // PUT: 更新数据
      jsonbinUrl = `${JSONBIN_BASE_URL}/b/${JSONBIN_BIN_ID}`;
    } else {
      return new Response('Invalid path. Use /latest or /update', { 
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': origin
        }
      });
    }

    // 构建请求头
    const headers = {
      'X-Master-Key': JSONBIN_API_KEY,
      'Content-Type': 'application/json'
    };

    // 获取请求体（如果有）
    let body = null;
    if (method === 'PUT' || method === 'POST') {
      body = await request.text();
    }

    // 转发请求到 JSONBin.io
    const response = await fetch(jsonbinUrl, {
      method: method,
      headers: headers,
      body: body
    });

    // 获取响应数据
    const data = await response.text();
    const status = response.status;

    // 返回响应，添加 CORS 头
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
    return new Response(JSON.stringify({ 
      error: error.message,
      message: '代理请求失败'
    }), {
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
```

2. **粘贴到编辑器**
   - Windows: `Ctrl + V`
   - Mac: `Command + V`

3. **⚠️ 重要：修改白名单**
   
   找到代码中的这一部分（第12-17行）：
   ```javascript
   const ALLOWED_ORIGINS = [
     'https://xadamshaw.github.io',  // ← 改成你的域名
     'http://localhost:8000',
     'http://localhost:3000',
     'http://127.0.0.1:8000'
   ];
   ```
   
   **如何修改**：
   - 找到 `'https://xadamshaw.github.io'` 这一行
   - 将它改成你的 GitHub Pages 域名
   - 例如：`'https://yourname.github.io'`
   - 保持单引号和逗号不变

### 4.4 保存代码

1. **点击右上角的 "Save and Deploy" 按钮**
   - 这是一个蓝色按钮
   - 或者按快捷键：
     - Windows: `Ctrl + S`
     - Mac: `Command + S`

2. **等待部署完成**
   - 会显示 "Deploying..." 进度
   - 几秒钟后会显示 "✅ Deployed"

3. **复制 Worker URL**
   - 页面顶部会显示你的 Worker URL
   - 例如：`https://jsonbin-proxy.yourname.workers.dev`
   - **⚠️ 重要：复制这个 URL 并保存到记事本**

---

## 第五步：测试 Worker

### 5.1 使用浏览器测试

1. **复制你的 Worker URL**
   ```
   https://jsonbin-proxy.yourname.workers.dev/latest
   ```
   
2. **在浏览器新标签页中打开**
   - 粘贴 URL
   - 按回车

3. **查看结果**
   
   **如果成功**，你会看到类似这样的 JSON 数据：
   ```json
   {
     "record": {
       "users": ["adam"],
       "config": {"theme": "dark"},
       ...
     },
     "metadata": {
       "id": "690cab8c43b1c97be99cd080",
       "private": true,
       ...
     }
   }
   ```
   
   **如果失败**，你会看到：
   - `Origin not allowed` → 检查白名单配置
   - `Invalid path` → URL 路径错误
   - 其他错误 → 检查 API Key 和 Bin ID

### 5.2 使用 curl 测试（可选）

如果你会使用命令行：

```bash
# 测试 GET 请求
curl https://jsonbin-proxy.yourname.workers.dev/latest

# 测试 PUT 请求
curl -X PUT https://jsonbin-proxy.yourname.workers.dev/update \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

---

## 第六步：配置项目使用 Worker

### 6.1 打开 script.js

在你的项目中，打开 `script.js` 文件。

### 6.2 修改配置

找到文件顶部的配置区域（第1-15行左右）：

```javascript
// ==================== Cloudflare Worker Configuration ====================
// 
// ⚠️ 重要：请将下面的 URL 替换为你的 Cloudflare Worker URL
// 
const CLOUDFLARE_WORKER_URL = 'https://your-worker.workers.dev'; // ⚠️ 替换为你的 Worker URL
```

**修改为**：

```javascript
const CLOUDFLARE_WORKER_URL = 'https://jsonbin-proxy.yourname.workers.dev'; // ⚠️ 替换为你的实际 Worker URL
```

**⚠️ 重要**：
- 将 `CLOUDFLARE_WORKER_URL` 改为你的 Worker URL（从第四步复制的）
- **不要**包含 `/latest` 或 `/update`，只要基础 URL
- 例如：`https://jsonbin-proxy.adam123.workers.dev`

### 6.3 保存文件

- Windows: `Ctrl + S`
- Mac: `Command + S`

---

## 第七步：部署到 GitHub Pages

### 7.1 提交代码

```bash
# 添加修改的文件
git add script.js

# 提交
git commit -m "Enable cloud sync with Cloudflare Worker proxy"

# 推送到 GitHub
git push origin main
```

### 7.2 等待部署

- GitHub Pages 会自动部署
- 通常需要 1-3 分钟

### 7.3 访问你的网站

打开浏览器，访问：
```
https://xadamshaw.github.io/10000-EngWords/
```

---

## 第八步：验证功能

### 8.1 打开浏览器控制台

1. **在网页上按 F12**（或右键 → 检查）
2. **切换到 "Console" 标签**

### 8.2 查看日志

加载 CSV 文件后，你应该看到：

**成功的日志**：
```
✅ 从云端获取同步数据成功
🔄 开始从云端批量同步数据...
✅ 云端同步完成：更新 X 条数据，耗时 XXXms
```

**如果失败**：
```
❌ 获取云端数据失败: ...
💡 提示: 如果遇到 CORS 错误，请查看 CORS_SOLUTION.md 文档
```

### 8.3 测试同步功能

1. **打星评分**
   - 点击任意单词卡片的星星
   - 查看控制台，应该看到：
   ```
   ✅ 同步数据到云端成功
   ⭐ 星级已更新并同步: xxx → X星
   ```

2. **查看同步状态**
   - 单词卡片右上角应该显示 "Synced" 而不是 "Local" 或 "⚠️"

---

## 🎯 故障排查

### 问题1：Worker 部署失败

**错误**：`Worker name already taken`

**解决**：
- 换一个名字，例如：`jsonbin-proxy-2`
- 或者删除现有的同名 Worker

---

### 问题2：测试 Worker 显示 "Origin not allowed"

**原因**：白名单配置错误

**解决**：
1. 回到 Worker 编辑器
2. 检查 `ALLOWED_ORIGINS` 数组
3. 确保包含你的域名
4. 保存并重新部署

---

### 问题3：网页仍然显示 CORS 错误

**检查清单**：
1. ✅ Worker 已成功部署
2. ✅ `ENABLE_CLOUD_SYNC = true`
3. ✅ `USE_PROXY = true`
4. ✅ `JSONBIN_BASE_URL` 正确（你的 Worker URL）
5. ✅ 代码已提交并推送到 GitHub
6. ✅ GitHub Pages 已重新部署
7. ✅ 清除浏览器缓存并刷新

---

### 问题4：Worker URL 忘记了

**找回方法**：
1. 登录 Cloudflare Dashboard
2. 进入 "Workers & Pages"
3. 找到你的 Worker（例如 `jsonbin-proxy`）
4. 点击它
5. URL 会显示在顶部

---

### 问题5：如何修改 Worker 代码

**步骤**：
1. 登录 Cloudflare Dashboard
2. Workers & Pages → 找到你的 Worker
3. 点击 "Edit code" 或 "Quick Edit"
4. 修改代码
5. 点击 "Save and Deploy"

---

## 📋 配置检查清单

部署完成后，请检查以下项目：

### Cloudflare Worker
- [ ] Worker 已创建并部署
- [ ] Worker URL 已复制保存
- [ ] 白名单包含你的 GitHub Pages 域名
- [ ] 测试 `/latest` 端点返回数据

### 项目代码
- [ ] `ENABLE_CLOUD_SYNC = true`
- [ ] `USE_PROXY = true`
- [ ] `JSONBIN_BASE_URL` 设置为 Worker URL
- [ ] 代码已提交到 GitHub
- [ ] GitHub Pages 已重新部署

### 功能测试
- [ ] 打开网页无 CORS 错误
- [ ] 控制台显示 "✅ 从云端获取同步数据成功"
- [ ] 打星评分后显示 "Synced"
- [ ] 刷新页面后星级仍然保留

---

## 🎉 完成！

恭喜！你已经成功配置了 Cloudflare Worker 代理，解决了 CORS 问题。

现在你的应用可以：
- ✅ 在浏览器中正常访问 JSONBin.io
- ✅ 跨设备同步学习进度
- ✅ 保护 API Key 不被暴露
- ✅ 享受 Cloudflare 的全球加速

---

## 💡 额外提示

### 免费额度

Cloudflare Workers 免费版提供：
- 每天 100,000 次请求
- 10ms CPU 时间/每次请求
- 对于个人使用完全足够

### 监控使用情况

在 Cloudflare Dashboard 中：
1. 进入你的 Worker
2. 点击 "Metrics" 标签
3. 查看请求数量和成功率

### 如果需要帮助

- Cloudflare 文档：https://developers.cloudflare.com/workers/
- 社区论坛：https://community.cloudflare.com/

---

## 📞 需要帮助？

如果在配置过程中遇到任何问题，请：
1. 检查控制台的详细错误信息
2. 参考故障排查部分
3. 查看 `CORS_SOLUTION.md` 文档
4. 检查 Cloudflare Worker 的日志

祝你配置顺利！🚀

