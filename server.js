// server.js
const cors = require('cors');

const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
// 允许跨域（若使用同源静态托管，可保留也无妨）
app.use(cors());
// 静态托管当前目录，便于同源访问 index.html
app.use(express.static(__dirname));

const COZE_API_KEY = process.env.COZE_API_KEY || 'pat_WR8uH9keNbGqSiwUYmFi4Xvye8UZtBSiKVu6hQiILJjKhdPpo4WagQSQlgCVpq9W';
const COZE_BOT_ID  = process.env.COZE_BOT_ID  || '7558867777532985384';
// 可固定一个 user_id，或根据会话生成
const DEFAULT_USER_ID = 'feihualing-user';

app.post('/coze/poem', async (req, res) => {
  const { keyword, used = [], difficulty = 'easy' } = req.body;

  // 给 Coze 的提示词，明确飞花令规则与输出格式（更严格约束）
  const systemPrompt = `你是"飞花令"古风诗词对手。严格遵守：
1) 必须返回且仅返回一条中文古诗词原句，且"逐字包含"关键字「${keyword}」，不可用同义/变体/近音替代。
2) 该句不得与以下任一已用句重复：${used.join('；') || '（无）'}。
3) 只输出严格 JSON：{"content":"诗句","author":"作者与出处"}，不得添加任何额外字符。
4) 若无法满足1）或不确定，请返回 {"content":"","author":""}。
5) 难度：${difficulty}，难度高时尽量避免过于常见句式。
6) 严禁输出解释、说明、错误提示、多余文字。仅输出 JSON。`;

  const fetchCozePoem = async () => {
    try {
      console.log('[Coze] request =>', { keyword, usedCount: used.length, difficulty });
      const chatResp = await fetch('https://api.coze.cn/v3/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${COZE_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          bot_id: COZE_BOT_ID,
          user_id: DEFAULT_USER_ID,
          stream: true,
          auto_save_history: true,
          additional_messages: [
            { role: 'user', content: systemPrompt, content_type: 'text' }
          ]
        })
      });
      if (!chatResp.ok || !chatResp.body) {
        const txt = chatResp ? await chatResp.text().catch(() => '') : 'no response';
        console.error('[Coze v2] http error', chatResp.status, txt);
        return { content: '', author: '' };
      }
      const reader = chatResp.body.getReader();
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
            console.log('[Coze v3][SSE]', evtName, JSON.stringify(payload).slice(0, 300));
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
      let text = finalText;

      if (!text) {
        try {
          const nonStream = await fetch('https://api.coze.cn/v3/chat', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${COZE_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              bot_id: COZE_BOT_ID,
              user_id: DEFAULT_USER_ID,
              stream: false,
              auto_save_history: true,
              additional_messages: [
                { role: 'user', content: systemPrompt, content_type: 'text' }
              ]
            })
          });
          const nonData = await nonStream.json().catch(() => ({}));
          console.log('[Coze v3][fallback] =>', JSON.stringify(nonData).slice(0, 500));
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

      let content = '', author = '';
      try {
        const parsed = JSON.parse(text);
        content = parsed.content || '';
        author = parsed.author || '';
      } catch {
        const jsonMatch = text.match(/\{[^}]*"content"[^}]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            content = parsed.content || '';
            author = parsed.author || '';
          } catch {
            content = text.trim();
            author = '';
          }
        } else {
          content = text.trim();
          author = '';
        }
      }
      console.log('[Coze] parsed =>', { content, author });
      return { content, author };
    } catch (e) {
      console.error('[Coze] exception =>', e);
      return { content: '', author: '' };
    }
  };

  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await fetchCozePoem();
    const chineseLen = (result.content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const isValid = result.content.includes(keyword) && chineseLen >= 5;
    if (isValid) {
      return res.json({ content: result.content, author: result.author });
    }
    console.warn(`[Coze] invalid result attempt ${attempt}`, result.content);
  }

  return res.json({ content: '', author: '' });
});

// 诗句校验：返回 { valid: boolean, reason?: string, normalizedContent?: string, author?: string }
app.post('/coze/validate', async (req, res) => {
  const { sentence = '', keyword = '' } = req.body || {};
  const localFail = (reason) => res.json({ valid: false, reason });
  // 本地硬性规则：≥5个中文字符且包含关键字
  const pure = (sentence || '').trim();
  const chinese = (pure.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chinese < 5) return localFail('字数不足（需≥5个汉字）');
  if (!pure.includes(keyword)) return localFail('不包含关键字');

  // 提示智能体进行诗句合法性判定，仅返回JSON
  const prompt = `判定以下句子是否为中文古诗词原句：\\n句子：「${pure}」\\n关键字：「${keyword}」\\n要求：仅返回JSON：{\\"valid\\":true|false, \\"reason\\":\\"原因\\", \\"normalizedContent\\":\\"（可选）标准化诗句\\", \\"author\\":\\"（可选）作者与出处\\"}。严禁输出JSON以外的任何文字。`;

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
    // 兼容多种返回结构
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

    try {
      const parsed = JSON.parse(text);
      // 与本地硬规则取交集：若智能体判true但本地不满足也视为false
      const finalValid = !!parsed.valid && chinese >= 5 && pure.includes(keyword);
      return res.json({
        valid: finalValid,
        reason: finalValid ? '' : (parsed.reason || '不符合规则'),
        normalizedContent: parsed.normalizedContent || pure,
        author: parsed.author || ''
      });
    } catch {
      return localFail('AI判定解析失败');
    }
  } catch (e) {
    return res.json({ valid: false, reason: e.message || 'AI判定调用失败' });
  }
});

// 诗词背景接口
app.post('/coze/background', async (req, res) => {
    const { poem, author } = req.body;
    
    if (!poem) {
        return res.status(400).json({ error: 'Missing poem' });
    }
    
    try {
        const systemPrompt = `你是古诗词专家。请为给定的诗句提供详细的背景介绍：
1) 开头必须说明讲解的是哪一句诗，格式为："（诗句内容）"出自...
2) 然后介绍诗句的创作背景、历史背景或文化内涵
3) 可以提及作者、朝代、创作情境等
4) 语言要简洁优美，富有诗意
5) 可以适当详细，但保持简洁
6) 只输出背景介绍，不要其他文字`;

        const requestBody = {
            bot_id: COZE_BOT_ID,
            user_id: 'feihualing-user',
            stream: true,
            auto_save_history: false,
            additional_messages: [
                {
                    role: 'user',
                    content: `请介绍这句诗"${poem}"${author ? `（作者：${author}）` : ''}的背景`
                }
            ]
        };

        console.log('[Coze Background] request =>', { poem, author });
        console.log('[Coze Background] request body =>', requestBody);

        const response = await fetch(`https://api.coze.cn/v3/chat`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${COZE_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify(requestBody)
        });

        // 使用流式处理，但严格控制字数
        if (!response.ok || !response.body) {
            const txt = response ? await response.text().catch(() => '') : 'no response';
            console.error('[Coze Background] http error', response.status, txt);
            return res.json({ background: '暂无背景信息' });
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalText = '';
        const answerChunksById = Object.create(null);
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // v3 SSE 一般以空行分隔 event + data
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
                    console.log('[Coze Background][SSE]', evtName, JSON.stringify(payload).slice(0, 300));
                    // 依据文档：chat 事件 data 为 Chat Object；message 事件 data 为 Message Object
                    if (evtName === 'conversation.message.delta') {
                        if (payload?.role === 'assistant' && payload?.type === 'answer' && typeof payload?.content === 'string') {
                            const id = payload?.id || 'default';
                            answerChunksById[id] = (answerChunksById[id] || '') + payload.content;
                            finalText = answerChunksById[id];
                        }
                    } else if (evtName === 'conversation.message.completed') {
                        if (payload?.role === 'assistant' && payload?.type === 'answer' && typeof payload?.content === 'string') {
                            const id = payload?.id || 'default';
                            // completed 提供完整内容，覆盖增量
                            answerChunksById[id] = payload.content;
                            finalText = payload.content;
                        }
                    } else if (evtName.includes('chat')) {
                        // Chat Object 内可能有 messages 数组
                        const msgs = payload?.messages || [];
                        if (Array.isArray(msgs) && msgs.length) {
                            const last = msgs.find(m => m.type === 'answer') || msgs[msgs.length - 1];
                            if (last?.content) finalText = last.content;
                        }
                    }
                } catch (e) {
                    console.warn('[Coze Background] parse chunk error', e.message, dataLine);
                }
            }
        }
        
        console.log('[Coze Background] final text =>', finalText);
        
        if (finalText) {
            let background = finalText.trim();
            res.json({ background });
        } else {
            res.json({ background: '暂无背景信息' });
        }
    } catch (error) {
        console.error('[Coze Background] error =>', error);
        res.json({ background: '暂无背景信息' });
    }
});

app.listen(3000, () => {
  console.log('Coze proxy listening on :3000');
});