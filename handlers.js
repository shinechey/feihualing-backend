const COZE_API_KEY = process.env.COZE_API_KEY || 'pat_WR8uH9keNbGqSiwUYmFi4Xvye8UZtBSiKVu6hQiILJjKhdPpo4WagQSQlgCVpq9W';
const COZE_BOT_ID = process.env.COZE_BOT_ID || '7558867777532985384';
const DEFAULT_USER_ID = 'feihualing-user';

const ensurePost = (req, res) => {
  if (req.method && req.method.toUpperCase() !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return false;
  }
  return true;
};

const parseBody = (req) => {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body;
};

const fetchCozeResponse = async (systemPrompt, options = {}) => {
  const payload = {
    bot_id: COZE_BOT_ID,
    user_id: DEFAULT_USER_ID,
    stream: !!options.stream,
    auto_save_history: options.autoSaveHistory ?? true,
    additional_messages: [
      { role: 'user', content: systemPrompt, content_type: 'text' }
    ]
  };

  const response = await fetch('https://api.coze.cn/v3/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${COZE_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.stream ? { 'Accept': 'text/event-stream' } : {})
    },
    body: JSON.stringify(payload)
  });

  return response;
};

const extractTextFromStream = async (response) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  const answerChunksById = Object.create(null);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      let evtName = '';
      let dataLine = '';
      for (const rawLine of chunk.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('event:')) evtName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLine = line.slice(5).trim();
      }
      if (!dataLine || dataLine === '[DONE]') continue;
      try {
        const payload = JSON.parse(dataLine);
        if (evtName === 'conversation.message.delta') {
          if (payload?.role === 'assistant' && payload?.type === 'answer' && typeof payload?.content === 'string') {
            const id = payload?.id || 'default';
            answerChunksById[id] = (answerChunksById[id] || '') + payload.content;
            finalText = answerChunksById[id];
          }
        } else if (evtName === 'conversation.message.completed') {
          if (payload?.role === 'assistant' && payload?.type === 'answer' && typeof payload?.content === 'string') {
            const id = payload?.id || 'default';
            answerChunksById[id] = payload.content;
            finalText = payload.content;
          }
        } else if (evtName.includes('chat')) {
          const msgs = payload?.messages || [];
          if (Array.isArray(msgs) && msgs.length) {
            const last = msgs.find(m => m.type === 'answer') || msgs[msgs.length - 1];
            if (last?.content) finalText = last.content;
          }
        } else if (payload?.content) {
          finalText = payload.content;
        }
      } catch {}
    }
  }
  return finalText;
};

const parseJsonText = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[^}]*"content"[^}]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return { content: text.trim(), author: '' };
      }
    }
    return { content: text.trim(), author: '' };
  }
};

// --- Handlers ---

const handlePoem = async (req, res) => {
  if (!ensurePost(req, res)) return;
  const { keyword = '', used = [], difficulty = 'easy' } = parseBody(req);

  const systemPrompt = `你是"飞花令"古风诗词对手。严格遵守：
1) 必须返回且仅返回一条中文古诗词原句，且"逐字包含"关键字「${keyword}」，不可用同义/变体/近音替代。
2) 该句不得与以下任一已用句重复：${used.join('；') || '（无）'}。
3) 只输出严格 JSON：{"content":"诗句","author":"作者与出处"}，不得添加任何额外字符。
4) 若无法满足1）或不确定，请返回 {"content":"","author":""}。
5) 难度：${difficulty}，难度高时尽量避免过于常见句式。
6) 严禁输出解释、说明、错误提示、多余文字。仅输出 JSON。`;

  const fetchOnce = async () => {
    const response = await fetchCozeResponse(systemPrompt, { stream: true });
    if (!response.ok || !response.body) {
      const txt = response ? await response.text().catch(() => '') : 'no response';
      console.error('[Coze v3] http error', response?.status, txt);
      return { content: '', author: '' };
    }
    let text = await extractTextFromStream(response);

    if (!text) {
      try {
        const nonStream = await fetchCozeResponse(systemPrompt, { stream: false });
        const nonData = await nonStream.json().catch(() => ({}));
        const msgs = nonData?.data?.messages || [];
        if (Array.isArray(msgs) && msgs.length) {
          const ans = msgs.find(m => m.type === 'answer') || msgs[msgs.length - 1];
          text = ans?.content || '';
        } else if (nonData?.data?.content) {
          text = nonData.data.content;
        } else if (nonData?.content) {
          text = nonData.content;
        }
      } catch {}
    }

    return parseJsonText(text || '');
  };

  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await fetchOnce();
    const chineseLen = (result.content?.match(/[\u4e00-\u9fa5]/g) || []).length;
    const isValid = !!result.content && result.content.includes(keyword) && chineseLen >= 5;
    if (isValid) {
      return res.status(200).json({ content: result.content.trim(), author: result.author || '' });
    }
    console.warn(`[Coze] invalid result attempt ${attempt}`, result.content);
  }

  return res.status(200).json({ content: '', author: '' });
};

const handleValidate = async (req, res) => {
  if (!ensurePost(req, res)) return;
  const { sentence = '', keyword = '' } = parseBody(req);
  const pure = (sentence || '').trim();
  const chinese = (pure.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chinese < 5) return res.json({ valid: false, reason: '字数不足（需≥5个汉字）' });
  if (!pure.includes(keyword)) return res.json({ valid: false, reason: '不包含关键字' });

  const prompt = `判定以下句子是否为中文古诗词原句：\n句子：「${pure}」\n关键字：「${keyword}」\n要求：仅返回JSON：{\\"valid\\":true|false, \\"reason\\":\\"原因\\", \\"normalizedContent\\":\\"（可选）标准化诗句\\", \\"author\\":\\"（可选）作者与出处\\"}。严禁输出JSON以外的任何文字。`;

  try {
    const resp = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bot_id: COZE_BOT_ID,
        user_id: DEFAULT_USER_ID,
        stream: false,
        auto_save_history: false,
        additional_messages: [ { role: 'user', content: prompt, content_type: 'text' } ]
      })
    });
    const data = await resp.json();
    let text = '';
    const msgs = data?.data?.messages || [];
    if (Array.isArray(msgs) && msgs.length) {
      const ans = msgs.find(m => m.type === 'answer') || msgs[msgs.length - 1];
      text = ans?.content || '';
    } else if (data?.data?.content) {
      text = data.data.content;
    } else if (data?.content) {
      text = data.content;
    }

    const parsed = JSON.parse(text);
    const finalValid = !!parsed.valid && chinese >= 5 && pure.includes(keyword);
    return res.json({
      valid: finalValid,
      reason: finalValid ? '' : (parsed.reason || '不符合规则'),
      normalizedContent: parsed.normalizedContent || pure,
      author: parsed.author || ''
    });
  } catch (e) {
    return res.json({ valid: false, reason: e.message || 'AI判定调用失败' });
  }
};

const handleBackground = async (req, res) => {
  if (!ensurePost(req, res)) return;
  const { poem = '', author = '' } = parseBody(req);
  if (!poem) {
    return res.status(400).json({ error: 'Missing poem' });
  }

  try {
    const requestBody = {
      bot_id: COZE_BOT_ID,
      user_id: DEFAULT_USER_ID,
      stream: true,
      auto_save_history: false,
      additional_messages: [
        {
          role: 'user',
          content: `请介绍这句诗"${poem}"${author ? `（作者：${author}）` : ''}的背景`
        }
      ]
    };

    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COZE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok || !response.body) {
      const txt = response ? await response.text().catch(() => '') : 'no response';
      console.error('[Coze Background] http error', response?.status, txt);
      return res.json({ background: '暂无背景信息' });
    }

    const backgroundText = await extractTextFromStream(response);
    if (backgroundText) {
      return res.json({ background: backgroundText.trim() });
    }
    return res.json({ background: '暂无背景信息' });
  } catch (error) {
    console.error('[Coze Background] error =>', error);
    return res.json({ background: '暂无背景信息' });
  }
};

module.exports = {
  handlePoem,
  handleValidate,
  handleBackground
};

