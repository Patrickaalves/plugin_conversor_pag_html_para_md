// translator.js - Tradução Resiliente com Preservação de Blockquotes (>)

async function translateMarkdownSafely(markdown, targetLang, onProgress, preferredService = 'google') {
  const map = new Map();
  let counter = 0;

  const regexesToProtect = [
    /<details[\s\S]*?<\/details>/gi,
    /```[\s\S]*?```/g,
    /<img[^>]+>/gi,
    /!\[[^\]]*\]\([^)]+\)/g,
    /\|[^\n]+\|\n\|[\s:-|-]+\|\n(\|[^\n]+\|\n?)*/g
  ];

  let protectedMarkdown = markdown;

  regexesToProtect.forEach(regex => {
    protectedMarkdown = protectedMarkdown.replace(regex, (match) => {
      const key = `XYZPROTECTEDBLOCK${counter}XYZ`;
      map.set(key, match);
      counter++;
      return `\n\n${key}\n\n`;
    });
  });

  const rawChunks = protectedMarkdown.split(/\n\s*\n/);
  const structuredChunks = [];
  const translatableIndexes = [];

  rawChunks.forEach((chunk) => {
    const trimmed = chunk.trim();
    if (!trimmed) {
      structuredChunks.push({ type: 'empty', text: '' });
      return;
    }

    let isProtected = map.has(trimmed);
    if (!isProtected) {
      for (let key of map.keys()) {
        if (trimmed.includes(key)) {
          isProtected = true;
          break;
        }
      }
    }

    if (isProtected) {
      structuredChunks.push({ type: 'protected', text: chunk });
    } else {
      structuredChunks.push({ type: 'text', text: chunk });
      translatableIndexes.push(structuredChunks.length - 1);
    }
  });

  const BATCH_SIZE = 15;
  const batches = [];
  
  for (let i = 0; i < translatableIndexes.length; i += BATCH_SIZE) {
    const batchIndexes = translatableIndexes.slice(i, i + BATCH_SIZE);
    batches.push(batchIndexes);
  }

  const totalBatches = batches.length;
  let hasTranslationFailed = false;

  for (let b = 0; b < totalBatches; b++) {
    const batchIndexes = batches[b];
    const batchTexts = batchIndexes.map(idx => structuredChunks[idx].text);

    if (onProgress) {
      onProgress(Math.round(((b + 1) / (totalBatches || 1)) * 100));
    }

    const translatedArray = await translateWithFallback(batchTexts, targetLang, preferredService);

    if (!translatedArray) {
      console.error(`❌ Falha crítica na tradução do lote ${b + 1}. Ambos os provedores falharam!`);
      hasTranslationFailed = true;
      break;
    }

    batchIndexes.forEach((chunkIdx, i) => {
      if (translatedArray[i] && typeof translatedArray[i] === 'string') {
        const originalText = structuredChunks[chunkIdx].text.trim();
        let cleanedText = cleanTranslatedMarkdown(translatedArray[i]);

        // PRESERVAÇÃO DE BLOCKQUOTE (>):
        // Se o bloco original começava com '>', garante que a tradução mantenha o '>'
        if (originalText.startsWith('>')) {
          cleanedText = cleanedText.replace(/^[\*\-\>\s]+/, '> ');
        }

        structuredChunks[chunkIdx].text = cleanedText;
      }
    });

    if (b < totalBatches - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (hasTranslationFailed) {
    return null;
  }

  let finalMarkdown = structuredChunks.map(c => c.text).join('\n\n');

  map.forEach((originalContent, key) => {
    finalMarkdown = finalMarkdown.replace(new RegExp(key, 'g'), () => originalContent);
  });

  return finalMarkdown.replace(/\n{3,}/g, '\n\n').trim();
}

// PIPELINE DINÂMICO DE FALLBACK
async function translateWithFallback(textArray, targetLang, preferredService = 'google') {
  if (!textArray || textArray.length === 0) return textArray;

  const primary = preferredService === 'docker' ? 'docker' : 'google';
  const fallback = primary === 'docker' ? 'google' : 'docker';

  try {
    const result = (primary === 'docker')
      ? await callDockerTranslateAPI(textArray, targetLang)
      : await callGoogleTranslateAPI(textArray, targetLang);

    if (result && Array.isArray(result) && result.length === textArray.length) {
      return result;
    }
  } catch (errPrimary) {
    console.warn(`⚠️ Provedor preferencial [${primary}] falhou: ${errPrimary.message}. Tentando fallback [${fallback}]...`);
  }

  try {
    const fallbackResult = (fallback === 'docker')
      ? await callDockerTranslateAPI(textArray, targetLang)
      : await callGoogleTranslateAPI(textArray, targetLang);

    if (fallbackResult && Array.isArray(fallbackResult) && fallbackResult.length === textArray.length) {
      console.log(`✅ Tradução realizada com sucesso via provedor de fallback [${fallback}]!`);
      return fallbackResult;
    }
  } catch (errFallback) {
    console.error(`❌ Ambos os provedores ([${primary}] e [${fallback}]) falharam:`, errFallback.message);
  }

  return null;
}

// Google Translate API
async function callGoogleTranslateAPI(textArray, targetLang) {
  const params = new URLSearchParams();
  textArray.forEach(t => params.append('q', t));
  
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

  const data = await response.json();
  if (Array.isArray(data)) {
    return data.map(item => {
      if (item && item[0] && Array.isArray(item[0])) {
        return item[0].map(sub => sub[0] || '').join('');
      }
      return '';
    });
  }
  throw new Error('Formato JSON do Google inválido');
}

// Docker LibreTranslate API
async function callDockerTranslateAPI(textArray, targetLang) {
  const endpoints = [
    'http://127.0.0.1:5000/translate',
    'http://localhost:5000/translate'
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: textArray,
          source: 'auto',
          target: targetLang,
          format: 'text'
        })
      });

      if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

      const data = await response.json();
      if (data && Array.isArray(data.translatedText)) {
        return data.translatedText;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`Docker inacessível: ${lastError?.message}`);
}

// SANITIZADOR DE MARKDOWN
function cleanTranslatedMarkdown(text) {
  if (!text) return text;

  let cleaned = text;

  // 1. Reduz sequências de 3 ou mais asteriscos para 2
  cleaned = cleaned.replace(/\*{3,}/g, '**');

  // 2. Tratamento atômico de negrito (limpa espaços internos e ajusta externos)
  cleaned = cleaned.replace(/(\S)?\s*\*\*([^*]+?)\*\*\s*(\S)?/g, (match, before, inner, after) => {
    const trimmedInner = inner.trim();
    if (!trimmedInner) return '';

    let result = `**${trimmedInner}**`;
    if (before) result = `${before} ${result}`;
    if (after) result = `${result} ${after}`;

    return result;
  });

  // 3. Ajusta pontuações coladas após negrito
  cleaned = cleaned.replace(/\*\*\s+([.,;:!?\)])/g, '**$1');
  cleaned = cleaned.replace(/([\(\[\{])\s+\*\*/g, '$1**');

  // 4. Corrige marcadores de listas (- **item**)
  cleaned = cleaned.replace(/^(\s*[\-\*])\s*(\*\*|\w)/gm, '$1 $2');

  // 5. Corrige títulos Markdown espaçados pela IA
  cleaned = cleaned
    .replace(/^#\s+#\s+#/gm, '###')
    .replace(/^#\s+#/gm, '##')
    .replace(/^#\s+/gm, '# ');

  return cleaned.replace(/ {2,}/g, ' ').trim();
}