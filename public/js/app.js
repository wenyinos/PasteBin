  const API_URL = '/api';
  let token = localStorage.getItem('token');
  let createModal;
  let tokenModal;
  let qrModal;
  let reportModal;
  let adminModal;
  let adminPane = 'stats';
  let ssoConfig = { loginUrl: '', logoutUrl: '' };

  // 超过该字节数的内容跳过 Prism 高亮：Prism 同步解析会阻塞主线程致页面假死
  const HIGHLIGHT_LIMIT = 32 * 1024;

  const langLabels = {
    plaintext: '纯文本', javascript: 'JavaScript', typescript: 'TypeScript',
    python: 'Python', java: 'Java', csharp: 'C#', cpp: 'C++', c: 'C',
    go: 'Go', rust: 'Rust', php: 'PHP', ruby: 'Ruby', swift: 'Swift',
    kotlin: 'Kotlin', html: 'HTML', css: 'CSS', scss: 'SCSS',
    json: 'JSON', xml: 'XML', yaml: 'YAML', markdown: 'Markdown',
    sql: 'SQL', bash: 'Bash', powershell: 'PowerShell', dockerfile: 'Dockerfile'
  };

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
  }

  // ---------- 客户端零知识加密 ----------
  // 内容在浏览器内用 AES-GCM 加密后再上传，服务端只存密文；
  // 解密密钥经 URL 的 # 片段传递，浏览器不会把 fragment 发给服务器。
  const PBKDF2_ITERATIONS = 150000;
  // crypto.subtle 仅在安全上下文可用（HTTPS 或 localhost）
  const cryptoSupported = !!(window.crypto && window.crypto.subtle) && window.isSecureContext === true;

  function bytesToB64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64Url(bytes) {
    return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64UrlToBytes(s) {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return b64ToBytes(b64);
  }

  async function deriveAesKey(password, salt) {
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  // 载荷格式：salt(16 字节) || iv(12 字节) || 密文，整体 base64
  async function encryptContent(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(password, salt);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const blob = new Uint8Array(16 + 12 + cipher.byteLength);
    blob.set(salt, 0);
    blob.set(iv, 16);
    blob.set(new Uint8Array(cipher), 28);
    return bytesToB64(blob);
  }

  async function decryptContent(b64blob, password) {
    const blob = b64ToBytes(b64blob);
    if (blob.length < 29) throw new Error('密文格式错误');
    const key = await deriveAesKey(password, blob.slice(0, 16));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(16, 28) }, key, blob.slice(28));
    return new TextDecoder().decode(plain);
  }

  function getFragmentPassword() {
    const raw = location.hash.slice(1);
    if (!raw) return '';
    try { return new TextDecoder().decode(b64UrlToBytes(raw)); } catch { return ''; }
  }

  // ---------- 通用提示层 ----------
  function showPrompt({ title, body, actions }) {
    document.getElementById('promptBody').innerHTML = `<h5>${title}</h5><p>${body}</p>`;
    const actionsEl = document.getElementById('promptActions');
    actionsEl.innerHTML = '';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = a.className;
      btn.textContent = a.label;
      btn.onclick = a.onClick;
      actionsEl.appendChild(btn);
    }
    document.getElementById('promptOverlay').style.display = 'flex';
  }

  function hidePrompt() {
    document.getElementById('promptOverlay').style.display = 'none';
  }

  function decodeJwtPayload(jwtToken) {
    try {
      if (!jwtToken) return null;
      const parts = jwtToken.split('.');
      if (parts.length < 2) return null;
      let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payload.length % 4 !== 0) payload += '=';
      return JSON.parse(atob(payload));
    } catch {
      return null;
    }
  }

  function getCurrentUser() {
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.username) return null;
    return payload;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    createModal = new bootstrap.Modal(document.getElementById('createModal'));
    tokenModal = new bootstrap.Modal(document.getElementById('tokenModal'));
    qrModal = new bootstrap.Modal(document.getElementById('qrModal'));
    reportModal = new bootstrap.Modal(document.getElementById('reportModal'));
    adminModal = new bootstrap.Modal(document.getElementById('adminModal'));
    await loadConfig();
    // 总是尝试统一认证兑换：浏览器携带中心票据即自动登录；票据已更换则自动切换账号；
    // 无票据（中心已退出）时清理本地遗留令牌，回落游客态
    const ssoOk = await trySilentSSO();
    if (!ssoOk) updateNav();

    const shortCode = getQueryParam('s');
    if (shortCode) {
      const loaded = await loadPublicPaste();
      if (!loaded) await loadAllPastes();
    } else {
      await loadAllPastes();
    }
  });

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  async function loadPublicPaste() {
    const shortCode = getQueryParam('s');
    if (!shortCode) return false;

    try {
      const res = await fetch('/api/paste/' + shortCode);
      if (!res.ok) return false;
      const paste = await res.json();

      // 阅后即焚：首次读取只返回"确认要求"，正文由 POST .../burn 交付并销毁
      if (paste.needs_confirmation) {
        return await confirmBurn(shortCode, paste);
      }

      return await displayPaste(paste);
    } catch (e) {
      console.error('loadPublicPaste:', e);
      return false;
    }
  }

  // 焚毁确认层：取消回列表；确认则取正文（服务端在同一次请求内销毁）
  function confirmBurn(shortCode, info) {
    return new Promise((resolve) => {
      const backToList = () => {
        hidePrompt();
        history.replaceState(null, '', location.pathname);
        loadAllPastes();
        resolve(false);
      };
      const suffix = info.title ? '（' + escapeHtml(info.title) + '）' : '';
      showPrompt({
        title: '<i class="bi bi-fire me-2"></i>阅后即焚',
        body: `此内容将在显示后<strong>永久删除</strong>，无法再次查看${suffix}。`,
        actions: [
          { label: '取消', className: 'btn-brand-outline', onClick: backToList },
          {
            label: '显示内容',
            className: 'btn-brand',
            onClick: async () => {
              hidePrompt();
              const r = await fetch(`/api/paste/${shortCode}/burn`, { method: 'POST' });
              if (!r.ok) { alert('内容已被其他访问者销毁'); backToList(); return; }
              const data = await r.json();
              await displayPaste(data, true);
              resolve(true);
            },
          },
        ],
      });
    });
  }

  // 加密内容的密码输入层，resolve(密码) 或 resolve(null) 表示取消
  function askPassword() {
    return new Promise((resolve) => {
      showPrompt({
        title: '<i class="bi bi-shield-lock me-2"></i>需要密码',
        body: '此内容已加密，请输入解密密码。',
        actions: [
          { label: '取消', className: 'btn-brand-outline', onClick: () => { hidePrompt(); resolve(null); } },
          {
            label: '解密',
            className: 'btn-brand',
            onClick: () => {
              const input = document.getElementById('promptPassword');
              hidePrompt();
              resolve(input ? input.value : null);
            },
          },
        ],
      });
      const input = document.createElement('input');
      input.type = 'password';
      input.id = 'promptPassword';
      input.className = 'form-control mb-2';
      input.placeholder = '密码';
      input.autocomplete = 'off';
      document.getElementById('promptBody').appendChild(input);
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.querySelector('#promptActions .btn-brand').click();
      });
    });
  }

  // 渲染详情。加密内容先解密（fragment 密钥优先，失败转手动输入）
  async function displayPaste(paste, burned = false) {
    if (paste.encrypted) {
      let plain = null;
      const fragPwd = getFragmentPassword();
      if (fragPwd && cryptoSupported) {
        try { plain = await decryptContent(paste.content, fragPwd); } catch { plain = null; }
      }
      if (plain === null) {
        if (!cryptoSupported) {
          alert('当前环境无法解密：需通过 HTTPS 或 localhost 访问（浏览器限制）');
          return false;
        }
        const pwd = await askPassword();
        if (pwd === null) return false;
        try {
          plain = await decryptContent(paste.content, pwd);
        } catch {
          alert('密码错误，或内容已损坏');
          return false;
        }
        // 解密成功：写入 fragment，使"分享链接"能带上密钥
        history.replaceState(null, '', location.pathname + location.search + '#' + bytesToB64Url(new TextEncoder().encode(pwd)));
      }
      paste.content = plain;
    }

    const burnEl = document.getElementById('burnNotice');
    if (burned) {
      burnEl.innerHTML = '<i class="bi bi-fire me-1"></i>内容已销毁，无法再次查看';
      burnEl.style.display = 'block';
    } else {
      burnEl.style.display = 'none';
    }

    document.getElementById('pasteAuthor').textContent = paste.username;
    document.getElementById('pasteTime').textContent = new Date(paste.created_at).toLocaleString();
    document.getElementById('displayPasteLanguage').textContent = (langLabels[paste.language] || paste.language) + (paste.encrypted ? ' · 已加密' : '');

    // 标题：无标题时不占位
    const titleEl = document.getElementById('displayPasteTitle');
    if (paste.title) {
      titleEl.textContent = paste.title;
      titleEl.style.display = 'block';
      document.title = paste.title + ' - Code PasteBin';
    } else {
      titleEl.style.display = 'none';
      document.title = 'Code PasteBin';
    }

    // 过期：显示到期时间与剩余时长
    const expiryEl = document.getElementById('displayPasteExpiry');
    if (paste.expires_at) {
      const leftMs = new Date(paste.expires_at).getTime() - Date.now();
      expiryEl.textContent = `过期于 ${new Date(paste.expires_at).toLocaleString()}（剩余 ${formatDuration(leftMs)}）`;
      expiryEl.style.display = 'block';
    } else {
      expiryEl.style.display = 'none';
    }

    drawCode(paste);

    // 分享链接：加密内容把密钥附在 fragment；界面上不显示密钥，防截图/屏幕共享泄漏
    const base = window.location.origin + window.location.pathname + '?s=' + paste.short_code;
    const shareUrl = (paste.encrypted && location.hash) ? base + location.hash : base;
    const linkEl = document.getElementById('shareLink');
    linkEl.href = shareUrl;
    linkEl.innerHTML = '<i class="bi bi-link-45deg me-1"></i>' +
      (paste.encrypted ? '分享链接（含解密密钥，已隐藏）' : '分享链接: ' + base);

    // 原始 / 下载 / 二维码等操作绑定
    currentPaste = paste;
    document.getElementById('rawLink').href = '/raw/' + paste.short_code;
    document.getElementById('dlLink').href = '/dl/' + paste.short_code;

    // Markdown 渲染切换：仅 markdown 类型显示按钮；?md=1 直接进入渲染视图
    const isMd = (paste.language || '').toLowerCase() === 'markdown';
    markdownMode = false;
    const mdBtn = document.getElementById('mdBtn');
    mdBtn.style.display = isMd ? 'inline-flex' : 'none';
    mdBtn.innerHTML = '<i class="bi bi-markdown me-1"></i>渲染';
    if (isMd && getQueryParam('md') === '1') toggleMarkdown();

    document.getElementById('mainSection').style.display = 'none';
    document.getElementById('publicView').style.display = 'block';

    applyLineHighlight();

    return true;
  }

  // ---------- 详情页增强：Markdown 渲染 / 行高亮 / 二维码 ----------
  let currentPaste = null;
  let markdownMode = false;

  // 渲染视图：marked 解析 + DOMPurify 消毒。
  // 外部资源一律剥离——前端渲染没有独立路由，无法只对该视图放宽 CSP，
  // 因此图片仅保留 data:/blob: 内联形式，其余连标签一并移除。
  function markdownToSafeHtml(source) {
    const html = marked.parse(source, { gfm: true, breaks: false });
    const safe = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio', 'link', 'meta'],
      ALLOWED_URI_REGEXP: /^(?:(?:data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    });
    const holder = document.createElement('div');
    holder.innerHTML = safe;
    holder.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!/^(data:|blob:)/i.test(src)) img.remove();
    });
    return holder.innerHTML;
  }

  function drawCode(paste) {
    const codeEl = document.getElementById('publicContent');
    const hintEl = document.getElementById('highlightHint');
    codeEl.className = '';
    codeEl.classList.add('language-' + (paste.language || 'plaintext'));
    codeEl.textContent = paste.content;

    // 大内容降级：超阈值只渲染纯文本，提示条可点击强制高亮
    if (paste.content.length > HIGHLIGHT_LIMIT) {
      hintEl.textContent = '内容较大（' + Math.round(paste.content.length / 1024) + ' KB），已关闭语法高亮，点击强制高亮';
      hintEl.style.display = 'block';
      hintEl.onclick = () => {
        hintEl.style.display = 'none';
        try { Prism.highlightElement(codeEl); } catch (e) { console.warn('Prism highlight failed:', e); }
      };
    } else {
      hintEl.style.display = 'none';
      try { Prism.highlightElement(codeEl); } catch (e) { console.warn('Prism highlight failed:', e); }
    }
  }

  function toggleMarkdown() {
    if (!currentPaste) return;
    const isMd = (currentPaste.language || '').toLowerCase() === 'markdown';
    if (!isMd) return;
    markdownMode = !markdownMode;
    const mdBtn = document.getElementById('mdBtn');
    const codeEl = document.getElementById('publicContent');
    const preEl = document.querySelector('#publicView pre');
    document.getElementById('highlightHint').style.display = 'none';

    if (markdownMode) {
      try {
        codeEl.className = 'markdown-body';
        codeEl.innerHTML = markdownToSafeHtml(currentPaste.content);
        if (preEl) preEl.classList.add('md-mode');
      } catch (e) {
        console.error('markdown render failed:', e);
        markdownMode = false;
      }
      mdBtn.innerHTML = '<i class="bi bi-file-code me-1"></i>源码';
      document.getElementById('publicView').querySelectorAll('.line-marker').forEach((n) => n.remove());
    } else {
      if (preEl) preEl.classList.remove('md-mode');
      drawCode(currentPaste);
      mdBtn.innerHTML = '<i class="bi bi-markdown me-1"></i>渲染';
      applyLineHighlight();
    }
  }

  // 行高亮：?hl=10-20 时按行高定位并叠加高亮条（不改动 Prism 生成的 DOM 结构）
  function applyLineHighlight() {
    const pre = document.querySelector('#publicView pre');
    if (!pre) return;
    pre.querySelectorAll('.line-marker').forEach((n) => n.remove());
    if (markdownMode) return;

    const hl = getQueryParam('hl');
    const m = hl && hl.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return;
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end < start) return;

    const codeEl = pre.querySelector('code') || pre;
    const lineHeight = parseFloat(getComputedStyle(codeEl).lineHeight) || 20;
    pre.style.position = 'relative';
    const marker = document.createElement('div');
    marker.className = 'line-marker';
    marker.style.top = ((start - 1) * lineHeight) + 'px';
    marker.style.height = ((end - start + 1) * lineHeight) + 'px';
    pre.appendChild(marker);
    marker.scrollIntoView({ block: 'center', behavior: 'instant' });
  }

  function showQr() {
    if (!currentPaste) return;
    const url = document.getElementById('shareLink').href;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      document.getElementById('qrCanvas').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 6 });
      document.getElementById('qrCaption').textContent = location.hash ? '扫码打开（链接含解密密钥）' : url;
      qrModal.show();
    } catch (e) {
      console.error('qr failed:', e);
      alert('二维码生成失败');
    }
  }

  // ---------- 敏感信息检测（纯前端提示，不阻断、不上报） ----------
  const SENSITIVE_PATTERNS = [
    { re: /-----BEGIN[^-]{0,40}PRIVATE KEY-----/, label: '私钥内容', high: true },
    { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS Access Key', high: true },
    { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/, label: 'GitHub Token', high: true },
    { re: /\bsk-[A-Za-z0-9]{32,}\b/, label: 'API Secret Key', high: true },
    { re: /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/i, label: '疑似口令 / 密钥赋值' },
    { re: /(?:mysql|postgres(?:ql)?|mongodb|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/i, label: '含账号口令的连接串' },
    { re: /ssh-rsa\s+AAAA[A-Za-z0-9+/=]{40,}/, label: 'SSH 公钥' },
    { re: /(?:^|[^\d])1[3-9]\d{9}(?:[^\d]|$)/, label: '疑似手机号' },
    { re: /(?:^|[^\dXx])\d{17}[\dXx](?:[^\dXx]|$)/, label: '疑似身份证号' },
  ];

  function detectSensitive(text) {
    const sample = text.slice(0, 64 * 1024);
    return SENSITIVE_PATTERNS.filter((p) => p.re.test(sample));
  }

  function confirmSensitive(hits) {
    return new Promise((resolve) => {
      const high = hits.some((h) => h.high);
      const items = hits.map((h) => '· ' + h.label + (h.high ? '（高危）' : '')).join('<br>');
      showPrompt({
        title: '<i class="bi bi-exclamation-triangle me-2"></i>检测到疑似敏感信息',
        body: `正文中可能包含：<br>${items}<br><br>` +
          (high
            ? '<strong>高危项请确认不是真实凭据</strong>——贴出后任何能看到此条的人都能读取。'
            : '如为示例代码可继续保存；此检查仅在本机进行，不会上报。'),
        actions: [
          { label: '返回修改', className: 'btn-brand-outline', onClick: () => { hidePrompt(); resolve(false); } },
          { label: high ? '确认并非真实凭据' : '仍然保存', className: 'btn-brand', onClick: () => { hidePrompt(); resolve(true); } },
        ],
      });
    });
  }

  // ---------- 快捷键 ----------
  function showShortcuts() {
    showPrompt({
      title: '<i class="bi bi-keyboard me-2"></i>快捷键',
      body: '<div class="kbd-list">' +
        '<div><kbd>r</kbd> 原始视图</div>' +
        '<div><kbd>c</kbd> 复制内容</div>' +
        '<div><kbd>y</kbd> 复制链接</div>' +
        '<div><kbd>q</kbd> 二维码</div>' +
        '<div><kbd>m</kbd> 渲染 / 源码切换</div>' +
        '<div><kbd>n</kbd> 返回列表</div>' +
        '<div><kbd>?</kbd> 本帮助</div>' +
        '</div>',
      actions: [{ label: '知道了', className: 'btn-brand', onClick: hidePrompt }],
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('.modal.show')) return;
    if (document.getElementById('promptOverlay').style.display === 'flex') return;

    if (e.key === '?') { e.preventDefault(); showShortcuts(); return; }

    const inDetail = document.getElementById('publicView').style.display !== 'none';
    if (!inDetail || !currentPaste) return;

    switch (e.key.toLowerCase()) {
      case 'r': e.preventDefault(); window.open('/raw/' + currentPaste.short_code, '_blank', 'noopener'); break;
      case 'c': e.preventDefault(); copyAllCode(document.getElementById('copyCodeBtn')); break;
      case 'y': e.preventDefault(); copyShareUrl(); break;
      case 'q': e.preventDefault(); showQr(); break;
      case 'm': e.preventDefault(); toggleMarkdown(); break;
      case 'n': e.preventDefault(); location.href = location.pathname; break;
      default: break;
    }
  });

  function copyShareUrl() {
    const url = document.getElementById('shareLink').href;
    navigator.clipboard?.writeText(url)
      .then(() => alert('已复制链接' + (location.hash ? '（含解密密钥）' : '')))
      .catch(() => alert('复制失败，请手动复制'));
  }

  function updateNav() {
    try {
      if (token) {
        const user = getCurrentUser();
        if (!user) throw new Error('Invalid token payload');
        document.getElementById('usernameDisplay').textContent = user.username;
        document.getElementById('userNav').style.display = 'flex';
        document.getElementById('guestNav').style.display = 'none';
        document.getElementById('newPasteBtn').style.display = 'inline-flex';
        checkAdmin();
      } else {
        document.getElementById('userNav').style.display = 'none';
        document.getElementById('guestNav').style.display = 'flex';
        document.getElementById('newPasteBtn').style.display = 'none';
      }
    } catch (e) {
      console.error('updateNav error:', e);
      token = null;
      localStorage.removeItem('token');
      document.getElementById('userNav').style.display = 'none';
      document.getElementById('guestNav').style.display = 'flex';
      document.getElementById('newPasteBtn').style.display = 'none';
    }
  }

  // ---------- 列表：最新 / 我的 + 搜索 + 分页 ----------
  const listState = { view: 'all', q: '', lang: '', page: 1, hasMore: false };

  async function loadAllPastes({ append = false } = {}) {
    const list = document.getElementById('pastesList');
    const moreBtn = document.getElementById('loadMoreBtn');

    document.getElementById('mainSection').style.display = 'block';
    document.getElementById('publicView').style.display = 'none';

    if (!append) {
      listState.page = 1;
      list.innerHTML = '<p class="text-soft text-center font-small">加载中…</p>';
    }

    const params = new URLSearchParams({ page: String(listState.page) });
    if (listState.q) params.set('q', listState.q);
    if (listState.lang) params.set('lang', listState.lang);
    const url = (listState.view === 'mine' ? `${API_URL}/pastes` : `${API_URL}/pastes/all`) + '?' + params;

    try {
      const res = listState.view === 'mine' ? await authFetch(url) : await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const items = data.items || [];
      listState.hasMore = !!data.hasMore;

      if (!append) list.innerHTML = '';
      if (!items.length && !append) {
        const empty = listState.q || listState.lang
          ? '没有匹配的内容'
          : (listState.view === 'mine' ? '你还没有创建过内容' : '暂无内容');
        list.innerHTML = '<p class="text-soft text-center font-small">' + empty + '</p>';
      } else {
        list.insertAdjacentHTML('beforeend', items.map(renderListItem).join(''));
      }
      if (moreBtn) moreBtn.style.display = listState.hasMore ? 'inline-flex' : 'none';
    } catch (e) {
      console.error(e);
      if (!append) {
        list.textContent = '';
        const p = document.createElement('p');
        p.className = 'text-soft text-center font-small';
        p.textContent = '加载失败：' + (e.message || e);
        list.appendChild(p);
      }
    }
  }

  function renderListItem(p) {
    const currentUser = getCurrentUser();
    // 按 user_id 判定所有权：用户名可改且非唯一键，不能作授权依据
    const isOwner = !!(currentUser && currentUser.id === p.user_id);
    const marks = [];
    if (p.visibility === 'private') marks.push('<span class="badge-warn">仅自己</span>');
    else if (p.visibility === 'unlisted') marks.push('<span class="badge-warn">仅链接</span>');
    if (p.burn_after_reading) marks.push('<span class="badge-warn">阅后即焚</span>');
    if (p.encrypted) marks.push('<span class="badge-warn">已加密</span>');
    if (p.expires_at) marks.push('<span class="badge-warn">' + formatDuration(new Date(p.expires_at) - Date.now()) + '后过期</span>');

    return `
      <div class="paste-card mb-3">
        <div class="paste-card-body">
          <div class="paste-meta-row d-flex justify-content-between align-items-start mb-2">
            <div class="paste-meta">
              <span class="badge-soft"><i class="bi bi-code-square me-1"></i>${escapeHtml(langLabels[p.language] || p.language)}</span>
              ${p.username ? `<span class="text-soft font-small ms-2"><i class="bi bi-person me-1"></i>${escapeHtml(p.username)}</span>` : ''}
              <small class="text-soft font-small ms-2"><i class="bi bi-clock me-1"></i>${new Date(p.created_at).toLocaleString()}</small>
              ${marks.join(' ')}
            </div>
            <div class="paste-actions">
              <a href="?s=${p.short_code}" class="btn-brand-outline"><i class="bi bi-eye me-1"></i>访问</a>
              ${isOwner ? `<button class="btn btn-sm btn-outline-danger ms-1" data-del="${p.id}"><i class="bi bi-trash me-1"></i>删除</button>` : ''}
            </div>
          </div>
          ${p.title ? `<div class="paste-title-row"><i class="bi bi-bookmark me-1"></i>${escapeHtml(p.title)}</div>` : ''}
          <div class="paste-summary">${escapeHtml(p.preview)}</div>
        </div>
      </div>`;
  }

  async function deletePaste(id) {
    if (!confirm('确定要删除这条代码吗？')) return;
    try {
      const res = await authFetch(`${API_URL}/pastes/${id}`, { method: 'DELETE' });
      if (res.ok) { loadAllPastes(); return; }
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        // 站点准入被撤销：定向回认证中心
        const target = data.loginUrl || ssoConfig.loginUrl;
        if (target) { window.location.href = target; return; }
      }
      if (res.status === 401) {
        token = null;
        localStorage.removeItem('token');
        updateNav();
      }
      alert(data.error || '删除失败');
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  function copyAllCode(btn) {
    const code = document.getElementById('publicContent').textContent;
    const originalHtml = btn.innerHTML;

    function onSuccess() {
      btn.innerHTML = '<i class="bi bi-check me-1"></i>已复制';
      btn.disabled = true;
      setTimeout(() => { btn.innerHTML = originalHtml; btn.disabled = false; }, 2000);
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(onSuccess).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); onSuccess(); }
      catch { alert('复制失败，请手动选择复制'); }
      document.body.removeChild(textarea);
    }
  }

  function goLogin() {
    if (ssoConfig.loginUrl) {
      window.location.href = ssoConfig.loginUrl;
    } else {
      alert('统一认证未启用，请联系社区管理员');
    }
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${API_URL}/config`);
      if (res.ok) {
        ssoConfig = await res.json();
        renderExpiryOptions(ssoConfig.expirationOptions || [0]);
      }
    } catch { /* 配置不可达时保留默认（空） */ }
  }

  // 过期选项标签（秒 → 中文）；可选值由服务端经 /api/config 下发，前端不硬编码列表
  const EXPIRY_LABELS = {
    0: '永不', 600: '10 分钟', 3600: '1 小时', 86400: '1 天',
    604800: '1 周', 2592000: '1 个月', 31536000: '1 年',
  };

  function renderExpiryOptions(options) {
    const group = document.getElementById('expiryGroup');
    group.innerHTML = options.map((sec, i) => `
      <label class="pill-option">
        <input type="radio" name="expires_in" value="${sec}"${i === 0 ? ' checked' : ''}>
        <span>${EXPIRY_LABELS[sec] || sec + ' 秒'}</span>
      </label>`).join('');
  }

  // 剩余时长的人话表达，最多两档（如「1 天 3 小时」）
  function formatDuration(ms) {
    const units = [['天', 86400000], ['小时', 3600000], ['分钟', 60000]];
    const parts = [];
    let left = ms;
    for (const [name, unitMs] of units) {
      const n = Math.floor(left / unitMs);
      if (n > 0) { parts.push(n + ' ' + name); left -= n * unitMs; }
      if (parts.length === 2) break;
    }
    return parts.length ? parts.join(' ') : '不足 1 分钟';
  }

  async function trySilentSSO() {
    try {
      const res = await fetch(`${API_URL}/sso`);
      if (res.status === 403) {
        // 账号未开通本站：定向回认证中心（已登录时自动进入面板查看提示）
        const data = await res.json().catch(() => ({}));
        const target = data.loginUrl || ssoConfig.loginUrl;
        if (target) { window.location.href = target; return true; }
        return false;
      }
      if (res.status === 401) {
        // 无中心票据 / 票据失效：清理本地遗留令牌，回落游客态
        if (token) { token = null; localStorage.removeItem('token'); }
        return false;
      }
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.token) return false;
      token = data.token;
      localStorage.setItem('token', token);
      updateNav();
      return true;
    } catch {
      return false;
    }
  }

  // 带认证的请求封装：自动附带令牌；服务端校准切换账号时经 X-New-Token 静默续签
  async function authFetch(url, options = {}) {
    options.headers = Object.assign({}, options.headers, { Authorization: `Bearer ${token}` });
    const res = await fetch(url, options);
    const newToken = res.headers.get('X-New-Token');
    if (newToken) {
      token = newToken;
      localStorage.setItem('token', token);
      updateNav();
    }
    return res;
  }

  function showCreateModal() {
    document.getElementById('pasteContent').value = '';
    document.getElementById('pasteLanguage').value = 'plaintext';
    document.getElementById('pasteTitle').value = '';
    document.getElementById('burnToggle').checked = false;
    document.getElementById('encryptToggle').checked = false;
    document.getElementById('encryptPassword').value = '';
    document.getElementById('encryptPasswordWrap').style.display = 'none';
    document.getElementById('encryptNotice').style.display = 'none';
    createModal.show();
  }

  async function doCreatePaste() {
    let content = document.getElementById('pasteContent').value;
    const language = document.getElementById('pasteLanguage').value;
    const title = document.getElementById('pasteTitle').value.trim();
    const visibility = document.querySelector('input[name="visibility"]:checked')?.value || 'public';
    const expiresIn = parseInt(document.querySelector('input[name="expires_in"]:checked')?.value || '0', 10);
    const burnAfterReading = document.getElementById('burnToggle').checked;
    const willEncrypt = document.getElementById('encryptToggle').checked;
    if (!content.trim()) return alert('内容不能为空');

    // 敏感信息提示：对原文检查（加密前），纯本地正则，不阻断也不上报
    const hits = detectSensitive(content);
    if (hits.length && !(await confirmSensitive(hits))) return;

    // 加密：在浏览器内完成，服务端只收到密文
    let clientSecret = '';
    if (willEncrypt) {
      if (!cryptoSupported) return alert('当前环境不支持加密：需通过 HTTPS 或 localhost 访问（浏览器安全上下文限制）');
      clientSecret = document.getElementById('encryptPassword').value;
      if (!clientSecret) return alert('请设置加密密码');
      try {
        content = await encryptContent(content, clientSecret);
      } catch (e) {
        console.error('encrypt failed:', e);
        return alert('加密失败，请重试');
      }
    }

    const res = await authFetch(`${API_URL}/pastes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content, language, title, visibility, expires_in: expiresIn,
        burn_after_reading: burnAfterReading, encrypted: willEncrypt,
      })
    });
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch {}
      if (res.status === 403) {
        // 站点准入被撤销：定向回认证中心
        const target = data.loginUrl || ssoConfig.loginUrl;
        if (target) { window.location.href = target; return; }
      }
      if (res.status === 401) {
        token = null;
        localStorage.removeItem('token');
        updateNav();
      }
      alert(data.error || `创建失败 (${res.status})`);
      return;
    }
    const data = await res.json();
    createModal.hide();
    // 加密内容的解密密钥放进 fragment（浏览器不发送 fragment，服务端与日志均不可见）
    const frag = willEncrypt ? '#' + bytesToB64Url(new TextEncoder().encode(clientSecret)) : '';
    window.location.href = '?s=' + data.short_code + frag;
  }

  // ---------- 举报 ----------
  document.getElementById('reportBtn').onclick = () => {
    if (!token) return alert('请先登录后再举报');
    document.getElementById('reportReason').value = '';
    reportModal.show();
  };

  document.getElementById('reportSubmitBtn').onclick = async () => {
    if (!currentPaste) return;
    const reason = document.getElementById('reportReason').value.trim();
    const res = await authFetch(`${API_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ short_code: currentPaste.short_code, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || '举报失败');
    reportModal.hide();
    alert(data.message || '已提交举报');
  };

  // ---------- 管理面板（bbs_gid 命中阈值的账号才显示入口） ----------
  async function checkAdmin() {
    if (!token) return;
    try {
      const res = await authFetch(`${API_URL}/admin/stats`);
      document.getElementById('adminBtn').style.display = res.ok ? 'inline-flex' : 'none';
    } catch {
      document.getElementById('adminBtn').style.display = 'none';
    }
  }

  document.getElementById('adminBtn').onclick = () => {
    adminModal.show();
    loadAdminPane(adminPane);
  };

  document.getElementById('adminTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.view-tab');
    if (!btn) return;
    document.querySelectorAll('#adminTabs .view-tab').forEach((b) => b.classList.toggle('active', b === btn));
    loadAdminPane(btn.dataset.pane);
  });

  async function loadAdminPane(pane) {
    adminPane = pane;
    const el = document.getElementById('adminPane');
    el.innerHTML = '<p class="text-soft font-small mb-0">加载中…</p>';
    if (pane === 'reports') return renderAdminReports(el);
    if (pane === 'pastes') return renderAdminPastes(el);
    return renderAdminStats(el);
  }

  async function renderAdminStats(el) {
    const res = await authFetch(`${API_URL}/admin/stats`);
    if (!res.ok) { el.innerHTML = '<p class="text-soft font-small mb-0">加载失败</p>'; return; }
    const s = await res.json();
    const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
    const rows = [
      ['内容总数', s.pastes],
      ['今日新增', s.pastesToday],
      ['公开 / 私有', s.publicPastes + ' / ' + s.privatePastes],
      ['加密 / 焚毁', s.encryptedPastes + ' / ' + s.burnPastes],
      ['待清理过期', s.expiredPending],
      ['累计浏览', s.totalViews],
      ['用户数', s.users],
      ['待处理举报', s.openReports],
      ['数据库大小', fmtSize(s.sizeBytes)],
    ];
    el.innerHTML = '<div class="admin-stats">' + rows
      .map(([k, v]) => `<div class="admin-stat"><div class="admin-stat-label">${k}</div><div class="admin-stat-value">${v}</div></div>`)
      .join('') + '</div>';
  }

  async function renderAdminReports(el) {
    const res = await authFetch(`${API_URL}/admin/reports`);
    if (!res.ok) { el.innerHTML = '<p class="text-soft font-small mb-0">加载失败</p>'; return; }
    const list = await res.json();
    if (!list.length) { el.innerHTML = '<p class="text-soft font-small mb-0">没有待处理的举报</p>'; return; }
    el.innerHTML = list.map((r) => `
      <div class="admin-row">
        <div class="admin-row-info">
          <div>
            <a href="?s=${r.short_code}" target="_blank" rel="noopener" class="admin-link">${escapeHtml(r.title || r.short_code)}</a>
            <span class="text-soft font-small">· 作者 ${escapeHtml(r.paste_owner_name)}</span>
          </div>
          <div class="text-soft font-small">举报人 ${escapeHtml(r.reporter_name)} · ${new Date(r.created_at).toLocaleString()}</div>
          ${r.reason ? `<div class="admin-reason">${escapeHtml(r.reason)}</div>` : ''}
        </div>
        <div class="admin-row-actions">
          <button class="btn-brand-outline" data-resolve="${r.id}" data-action="dismiss">忽略</button>
          <button class="btn-brand-outline danger" data-resolve="${r.id}" data-action="delete">删除内容</button>
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-resolve]').forEach((btn) => {
      btn.onclick = () => resolveReport(btn.dataset.resolve, btn.dataset.action);
    });
  }

  async function resolveReport(id, action) {
    if (action === 'delete' && !confirm('确认删除被举报的内容？该操作不可撤销。')) return;
    const res = await authFetch(`${API_URL}/admin/reports/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return alert(d.error || '处理失败');
    }
    loadAdminPane('reports');
  }

  async function renderAdminPastes(el) {
    const res = await authFetch(`${API_URL}/admin/pastes?limit=30`);
    if (!res.ok) { el.innerHTML = '<p class="text-soft font-small mb-0">加载失败</p>'; return; }
    const data = await res.json();
    if (!data.items.length) { el.innerHTML = '<p class="text-soft font-small mb-0">暂无内容</p>'; return; }
    el.innerHTML = data.items.map((p) => `
      <div class="admin-row">
        <div class="admin-row-info">
          <div>
            <a href="?s=${p.short_code}" target="_blank" rel="noopener" class="admin-link">${escapeHtml(p.title || p.short_code)}</a>
            <span class="badge-soft ms-1">${escapeHtml(p.language)}</span>
            ${p.visibility !== 'public' ? `<span class="badge-warn">${p.visibility === 'private' ? '仅自己' : '仅链接'}</span>` : ''}
            ${p.encrypted ? '<span class="badge-warn">已加密</span>' : ''}
          </div>
          <div class="text-soft font-small">${escapeHtml(p.username)} · ${new Date(p.created_at).toLocaleString()} · 浏览 ${p.views}</div>
        </div>
        <div class="admin-row-actions">
          <button class="btn-brand-outline danger" data-del-paste="${p.id}">删除</button>
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-del-paste]').forEach((btn) => {
      btn.onclick = () => adminDeletePaste(btn.dataset.delPaste);
    });
  }

  async function adminDeletePaste(id) {
    if (!confirm('确认删除该内容？该操作不可撤销。')) return;
    const res = await authFetch(`${API_URL}/admin/pastes/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return alert(d.error || '删除失败');
    }
    loadAdminPane('pastes');
  }

  document.getElementById('logoutBtn').onclick = () => {
    token = null;
    localStorage.removeItem('token');
    // 全域登出：跳转认证中心退出页（销毁中心票据后回登录页）
    window.location.href = ssoConfig.logoutUrl || '/';
  };

  // 加密开关：仅在勾选时显示密码输入与说明；非安全上下文直接拒绝勾选
  document.getElementById('encryptToggle').addEventListener('change', (e) => {
    let on = e.target.checked;
    if (on && !cryptoSupported) {
      alert('当前环境不支持加密：需通过 HTTPS 或 localhost 访问（浏览器安全上下文限制）');
      e.target.checked = false;
      on = false;
    }
    document.getElementById('encryptPasswordWrap').style.display = on ? '' : 'none';
    document.getElementById('encryptNotice').style.display = on ? '' : 'none';
  });

  // ---------- 列表与详情页控件绑定 ----------
  document.getElementById('refreshBtn').onclick = () => loadAllPastes();
  document.getElementById('loadMoreBtn').onclick = () => {
    listState.page += 1;
    loadAllPastes({ append: true });
  };
  document.getElementById('copyCodeBtn').onclick = (e) => copyAllCode(e.currentTarget);
  document.getElementById('qrBtn').onclick = showQr;
  document.getElementById('mdBtn').onclick = toggleMarkdown;
  document.getElementById('helpBtn').onclick = showShortcuts;

  // 视图切换（最新 / 我的）
  document.getElementById('viewTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.view-tab');
    if (!btn) return;
    document.querySelectorAll('#viewTabs .view-tab').forEach((b) => b.classList.toggle('active', b === btn));
    listState.view = btn.dataset.view;
    loadAllPastes();
  });

  // 搜索：输入防抖 300ms
  let filterTimer = null;
  document.getElementById('listFilter').addEventListener('input', (e) => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      listState.q = e.target.value.trim();
      loadAllPastes();
    }, 300);
  });

  // 删除按钮用事件委托，避免内联 onclick（也为将来去掉 unsafe-inline 铺路）
  document.getElementById('pastesList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (btn) deletePaste(btn.dataset.del);
  });

  // ---------- API Token 管理 ----------
  document.getElementById('tokenBtn').onclick = () => {
    document.getElementById('tokenName').value = '';
    document.getElementById('tokenNewWrap').style.display = 'none';
    tokenModal.show();
    loadTokens();
  };

  async function loadTokens() {
    const listEl = document.getElementById('tokenList');
    const res = await authFetch(`${API_URL}/tokens`);
    if (!res.ok) { listEl.innerHTML = '<p class="text-soft font-small mb-0">加载失败</p>'; return; }
    const list = await res.json();
    if (!list.length) {
      listEl.innerHTML = '<p class="text-soft font-small mb-0">尚未创建任何 Token</p>';
      return;
    }
    listEl.innerHTML = list.map((t) => `
      <div class="token-item">
        <div class="token-item-info">
          <div class="token-name">${escapeHtml(t.name)}</div>
          <div class="text-soft font-small">
            创建 ${new Date(t.created_at).toLocaleDateString()}
            · 最近使用 ${t.last_used_at ? new Date(t.last_used_at).toLocaleString() : '从未'}
            · 过期 ${t.expires_at ? new Date(t.expires_at).toLocaleDateString() : '永不'}
          </div>
        </div>
        <button class="btn-brand-outline" data-revoke="${t.id}">撤销</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-revoke]').forEach((btn) => {
      btn.onclick = () => revokeToken(btn.dataset.revoke);
    });
  }

  document.getElementById('tokenCreateBtn').onclick = async () => {
    const name = document.getElementById('tokenName').value.trim();
    if (!name) return alert('请输入名称');
    const res = await authFetch(`${API_URL}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || '创建失败');
    document.getElementById('tokenNewValue').textContent = data.token;
    document.getElementById('tokenNewWrap').style.display = 'block';
    document.getElementById('tokenName').value = '';
    loadTokens();
  };

  document.getElementById('tokenCopyBtn').onclick = () => {
    const value = document.getElementById('tokenNewValue').textContent;
    navigator.clipboard?.writeText(value)
      .then(() => alert('已复制，请妥善保存'))
      .catch(() => alert('复制失败，请手动选中复制'));
  };

  async function revokeToken(id) {
    if (!confirm('确定撤销该 Token？使用它的脚本将立即失效。')) return;
    const res = await authFetch(`${API_URL}/tokens/${id}`, { method: 'DELETE' });
    if (!res.ok) return alert('撤销失败');
    loadTokens();
  }
