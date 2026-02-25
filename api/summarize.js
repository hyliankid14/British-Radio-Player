/**
 * Vercel Serverless Function: AI Text Summarization
 * Uses Hugging Face Inference API (completely free, no API key required)
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

        // Call Hugging Face API
        const summary = await summarizeWithHuggingFace(text);
        
        // Cache the result
        setCache(hash, summary);
        
        res.json({ summary, cached: false });
    } catch (err) {
        console.error('Summarization error:', err);
        res.status(500).json({ error: err.message || 'Failed to summarize' });
    }
}

/**
 * Summarize text using Hugging Face Inference API (completely free)
 */
async function summarizeWithHuggingFace(text) {
    // Using public inference API - no API key required for rate-limited access
    const cleanText = text.substring(0, 2000).trim();
    const prompt = `Summarize in 30 words: ${cleanText}`;

    try {
        const response = await fetch('https://router.huggingface.co/models/facebook/bart-large-cnn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: cleanText,
                parameters: {
                    max_length: 100,
                    min_length: 20,
                    do_sample: false
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Hugging Face API error: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        
        // Extract text from response
        let summary = '';
        if (Array.isArray(data) && data[0] && data[0].summary_text) {
            summary = data[0].summary_text.trim();
        } else if (data.summary_text) {
            summary = data.summary_text.trim();
        } else {
            throw new Error('Unexpected response format from Hugging Face');
        }

        // Validate response
        if (!summary || summary.length < 3) {
            throw new Error('Empty or invalid response from Hugging Face');
        }

        if (summary.length > 500) {
            summary = limitToWords(summary, 30);
        }

        return summary;
    } catch (error) {
        console.error('Hugging Face API error:', error);
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
