/**
 * Vercel Serverless Function: AI Text Summarization
 * Uses Together.ai API to summarize podcast descriptions
 * API key is kept server-side and never exposed to clients
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

        // Call Together.ai API
        const summary = await summarizeWithTogetherAI(text);
        
        // Cache the result
        setCache(hash, summary);
        
        res.json({ summary, cached: false });
    } catch (err) {
        console.error('Summarization error:', err);
        res.status(500).json({ error: err.message || 'Failed to summarize' });
    }
}

/**
 * Summarize text using Together.ai API
 */
async function summarizeWithTogetherAI(text) {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) {
        throw new Error('TOGETHER_API_KEY is not configured');
    }

    const cleanText = text.substring(0, 2000).trim();
    const prompt = `Summarize in 30 words: ${cleanText}`;

    try {
        const response = await fetch('https://api.together.xyz/inference', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'meta-llama/Llama-2-7b-chat-hf',
                prompt: prompt,
                max_tokens: 100,
                temperature: 0.7,
                top_p: 0.9,
                top_k: 50
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Together.ai API error: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        
        // Extract text from response
        let summary = '';
        if (data.output && data.output.choices && data.output.choices[0]) {
            summary = data.output.choices[0].text.trim();
        } else if (data.choices && data.choices[0]) {
            summary = data.choices[0].text.trim();
        } else {
            throw new Error('Unexpected response format from Together.ai');
        }

        // Validate response
        if (!summary || summary.length < 3) {
            throw new Error('Empty or invalid response from Together.ai');
        }

        if (summary.length > 500) {
            // Fallback to truncation if response is too long
            summary = limitToWords(summary, 30);
        }

        return summary;
    } catch (error) {
        console.error('Together.ai API error:', error);
        throw error;
    }
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
