/**
 * Vercel Serverless Function: AI Text Summarization
 * Uses OpenRouter's free Gemma model with extractive fallback
 * No API key required for free tier
 */

const cache = new Map();
const CACHE_TTL = 3600000; // 1 hour

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { text } = req.body;
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Invalid text provided' });
    }

    if (text.length === 0) {
        return res.status(400).json({ error: 'Text cannot be empty' });
    }

    try {
        // Check cache first
        const hash = generateHash(text);
        const cached = getFromCache(hash);
        if (cached) {
            return res.json({ summary: cached, cached: true });
        }

        // Use AI summarization with extractive fallback
        const summary = await summarizeWithAI(text);
        
        // Cache the result
        setCache(hash, summary);
        
        res.json({ summary, cached: false });
    } catch (err) {
        console.error('Summarization error:', err);
        res.status(500).json({ error: err.message || 'Failed to summarize' });
    }
}

/**
 * Summarize text using free AI models via OpenRouter
 * Uses completely free models - no API key required for basic tier
 */
async function summarizeWithAI(text) {
    const cleanText = text.substring(0, 2000).trim();
    
    try {
        // Try OpenRouter's free models first
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://bbc-radio-player.vercel.app',
                'X-Title': 'BBC Radio Player'
            },
            body: JSON.stringify({
                model: 'google/gemma-2-9b-it:free',
                messages: [{
                    role: 'user',
                    content: `Summarize this in exactly 30 words or less:\n\n${cleanText}`
                }],
                max_tokens: 100,
                temperature: 0.7
            })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.choices && data.choices[0] && data.choices[0].message) {
                const summary = data.choices[0].message.content.trim();
                if (summary.length > 3 && summary.length < 500) {
                    return limitToWords(summary, 30);
                }
            }
        }
    } catch (err) {
        console.warn('OpenRouter failed, trying fallback:', err.message);
    }
    
    // Fallback to extractive if AI fails
    return summarizeExtractively(text);
}

/**
 * Simple extractive summarization (fallback)
 */
function summarizeExtractively(text) {
    const cleanText = text.substring(0, 2000).trim();
    
    // Split into sentences
    const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    if (sentences.length <= 2) {
        return limitToWords(cleanText, 30);
    }
    
    // Calculate word frequencies (excluding common words)
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how']);
    
    const wordFreq = {};
    const words = cleanText.toLowerCase().match(/\b\w+\b/g) || [];
    
    words.forEach(word => {
        if (word.length > 3 && !stopWords.has(word)) {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
    });
    
    // Score sentences based on word frequency
    const scoredSentences = sentences.map((sentence, index) => {
        const sentenceWords = sentence.toLowerCase().match(/\b\w+\b/g) || [];
        const score = sentenceWords.reduce((sum, word) => {
            return sum + (wordFreq[word] || 0);
        }, 0) / sentenceWords.length;
        
        // Prefer earlier sentences slightly
        const positionBonus = (sentences.length - index) * 0.1;
        
        return {
            text: sentence.trim(),
            score: score + positionBonus,
            index
        };
    });
    
    // Sort by score and take top sentences
    scoredSentences.sort((a, b) => b.score - a.score);
    
    // Take top 2 sentences, re-order by original position
    const topSentences = scoredSentences.slice(0, 2).sort((a, b) => a.index - b.index);
    const summary = topSentences.map(s => s.text).join('. ') + '.';
    
    // Ensure it's within 30 words
    return limitToWords(summary, 30);
}

/**
 * Simple in-memory cache (works on Vercel)
 */
function generateHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

function getFromCache(hash) {
    const entry = cache.get(hash);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
        return entry.value;
    }
    cache.delete(hash);
    return null;
}

function setCache(hash, value) {
    cache.set(hash, { value, timestamp: Date.now() });
    
    // Keep cache size reasonable (max 100 entries)
    if (cache.size > 100) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
}

/**
 * Limit text to a specific number of words
 */
function limitToWords(text, maxWords) {
    const words = text.trim().split(/\s+/).filter(w => w);
    if (words.length <= maxWords) return words.join(' ');
    return words.slice(0, maxWords).join(' ') + '...';
}
