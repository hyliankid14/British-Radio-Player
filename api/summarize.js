/**
 * Vercel Serverless Function: Smart Text Summarization
 * Uses improved extractive summarization algorithm
 * Fast, reliable, and completely free
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

        // Use smart extractive summarization
        const summary = summarizeExtractively(text);
        
        // Cache the result
        setCache(hash, summary);
        
        res.json({ summary, cached: false });
    } catch (err) {
        console.error('Summarization error:', err);
        res.status(500).json({ error: err.message || 'Failed to summarize' });
    }
}

/**
 * Smart extractive summarization
 * Creates concise summaries by selecting key information
 */
function summarizeExtractively(text) {
    const cleanText = text.substring(0, 2000).trim();
    
    // Split into sentences
    const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    if (sentences.length === 0) {
        return limitToWords(cleanText, 30);
    }
    
    if (sentences.length === 1) {
        return limitToWords(sentences[0], 30);
    }
    
    // Calculate word frequencies (excluding common words)
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once']);
    
    const wordFreq = {};
    const words = cleanText.toLowerCase().match(/\b\w+\b/g) || [];
    
    words.forEach(word => {
        if (word.length > 3 && !stopWords.has(word)) {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
    });
    
    // Score sentences based on important content
    const scoredSentences = sentences.map((sentence, index) => {
        const sentenceWords = sentence.toLowerCase().match(/\b\w+\b/g) || [];
        const importantWords = sentenceWords.filter(w => w.length > 3 && !stopWords.has(w));
        
        // Score based on frequency of important words
        const freqScore = importantWords.reduce((sum, word) => {
            return sum + (wordFreq[word] || 0);
        }, 0);
        
        // Normalize by sentence length to favor concise sentences
        const lengthPenalty = sentenceWords.length > 15 ? 0.7 : 1.0;
        
        // Strong preference for first sentence (usually contains main topic)
        const positionBonus = index === 0 ? 3.0 : (index === 1 ? 1.5 : 0.5);
        
        const score = (freqScore / Math.max(importantWords.length, 1)) * lengthPenalty + positionBonus;
        
        return {
            text: sentence.trim(),
            score: score,
            index,
            wordCount: sentenceWords.length
        };
    });
    
    // Sort by score
    scoredSentences.sort((a, b) => b.score - a.score);
    
    // Build summary from top sentences, respecting word limit
    let summary = '';
    let wordCount = 0;
    const maxWords = 30;
    
    for (const sent of scoredSentences) {
        if (wordCount + sent.wordCount <= maxWords) {
            summary += (summary ? ' ' : '') + sent.text + '.';
            wordCount += sent.wordCount;
        } else if (wordCount < maxWords) {
            // Add partial sentence if we have room
            const remainingWords = maxWords - wordCount;
            const words = sent.text.split(/\s+/);
            summary += (summary ? ' ' : '') + words.slice(0, remainingWords).join(' ') + '...';
            break;
        } else {
            break;
        }
    }
    
    return summary || limitToWords(sentences[0], 30);
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
